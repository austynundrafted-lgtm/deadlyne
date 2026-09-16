//! FTP delivery: sends finished photos (captions already embedded in the JPGs) to a newsroom, wire
//! service or client server over FTP or FTPS. Built for bad stadium connections: every socket has a
//! timeout, dropped connections reconnect and retry the file, and one send runs at a time.
//!
//! Passwords live in the system keychain (macOS Keychain, Windows Credential Manager), never in the
//! settings file, and never travel back to the interface.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Read;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use rustls_platform_verifier::BuilderVerifierExt;
use suppaftp::types::FileType;
use suppaftp::{FtpError, Mode, RustlsConnector, RustlsFtpStream as FtpStream, Status};
use tauri::{AppHandle, Emitter};

const KEYCHAIN_SERVICE: &str = "app.deadlyne.desktop.ftp";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const IO_TIMEOUT: Duration = Duration::from_secs(45);
const ATTEMPTS: usize = 3;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    Ftp,
    /// Explicit TLS (AUTH TLS on the normal port), what most FTPS servers mean.
    Ftps,
    /// Implicit TLS, usually on port 990.
    FtpsImplicit,
}

/// What to do when a file with the same name is already on the server.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum IfExists {
    /// Send it as MCD_0001-1.JPG. The safe default: camera counters repeat across games.
    Rename,
    /// Overwrite, e.g. to refile a photo with a corrected caption.
    Replace,
    Skip,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub remote_dir: String,
    pub passive: bool,
    pub if_exists: IfExists,
}

// MARK: - Passwords

fn keychain(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, id).map_err(|e| e.to_string())
}

fn stored_password(id: &str) -> Result<Option<String>, String> {
    match keychain(id)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn’t read the password from the keychain: {e}")),
    }
}

#[tauri::command]
pub async fn ftp_set_password(id: String, password: String) -> Result<(), String> {
    crate::jobs::blocking(move || {
        let entry = keychain(&id)?;
        if password.is_empty() {
            return match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            };
        }
        entry.set_password(&password).map_err(|e| format!("Couldn’t save the password to the keychain: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn ftp_has_password(id: String) -> bool {
    crate::jobs::blocking(move || matches!(stored_password(&id), Ok(Some(_)))).await
}

// MARK: - Connecting

/// Why a step failed, so the send loop knows whether trying again can help.
#[derive(Debug)]
enum Failure {
    /// Network trouble or a busy server (4xx): reconnect and retry.
    Transient(String),
    /// The server refused this file (5xx): retrying won't help, move on.
    Refused(String),
    /// Wrong password, unknown host, bad certificate: stop the whole send.
    Fatal(String),
    Cancelled,
}

impl Failure {
    fn message(&self) -> String {
        match self {
            Failure::Transient(m) | Failure::Refused(m) | Failure::Fatal(m) => m.clone(),
            Failure::Cancelled => "Stopped".into(),
        }
    }
}

fn server_says(e: &FtpError) -> String {
    match e {
        FtpError::UnexpectedResponse(r) => {
            let body = String::from_utf8_lossy(&r.body);
            let body = body.trim();
            // Replies look like "550 Permission denied."; keep the server's own words.
            if body.is_empty() { format!("the server replied {}", r.status.code()) } else { format!("the server said “{body}”") }
        }
        FtpError::ConnectionError(io) => io.to_string(),
        FtpError::SecureError(s) => format!("secure connection failed ({s})"),
        other => other.to_string(),
    }
}

fn classify(e: FtpError, doing: &str) -> Failure {
    let msg = format!("{doing}: {}", server_says(&e));
    match &e {
        FtpError::UnexpectedResponse(r) if (500..600).contains(&r.status.code()) => Failure::Refused(msg),
        FtpError::SecureError(_) => Failure::Fatal(msg),
        _ => Failure::Transient(msg),
    }
}

fn connect(s: &Server, password: &str) -> Result<FtpStream, Failure> {
    let host = s.host.trim();
    if host.is_empty() {
        return Err(Failure::Fatal("No server address".into()));
    }
    let addrs: Vec<SocketAddr> = (host, s.port)
        .to_socket_addrs()
        .map_err(|e| Failure::Transient(format!("Couldn’t find {host} ({e}). Check the address and your connection.")))?
        .collect();
    // One TLS config per connection: data connections resume the control connection's TLS session,
    // which vsftpd and FileZilla Server require by default. Certificates are checked by the OS.
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .and_then(|b| b.with_platform_verifier())
        .map(|b| Arc::new(b.with_no_client_auth()))
        .map_err(|e| Failure::Fatal(format!("Secure connections aren’t available: {e}")));
    let tls = || config.as_ref().map(|c| RustlsConnector::from(Arc::clone(c))).map_err(|e| Failure::Fatal(e.message()));

    let mut last = Failure::Transient(format!("Couldn’t reach {host}"));
    let mut ftp = None;
    for addr in addrs {
        let attempt = if s.protocol == Protocol::FtpsImplicit {
            FtpStream::connect_secure_implicit(addr, tls()?, host)
        } else {
            // Our own socket, so a server that accepts but never greets can't hang the send.
            match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
                Ok(tcp) => {
                    let _ = tcp.set_read_timeout(Some(IO_TIMEOUT));
                    let _ = tcp.set_write_timeout(Some(IO_TIMEOUT));
                    FtpStream::connect_with_stream(tcp)
                }
                Err(e) => Err(FtpError::ConnectionError(e)),
            }
        };
        match attempt {
            Ok(f) => {
                ftp = Some(f);
                break;
            }
            Err(e) => last = classify(e, &format!("Couldn’t connect to {host}:{}", s.port)),
        }
    }
    let Some(mut ftp) = ftp else { return Err(last) };
    {
        let sock = ftp.get_ref();
        let _ = sock.set_read_timeout(Some(IO_TIMEOUT));
        let _ = sock.set_write_timeout(Some(IO_TIMEOUT));
    }
    // Data connections get timeouts too.
    ftp = ftp.passive_stream_builder(|addr| {
        let tcp = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(FtpError::ConnectionError)?;
        let _ = tcp.set_read_timeout(Some(IO_TIMEOUT));
        let _ = tcp.set_write_timeout(Some(IO_TIMEOUT));
        Ok(tcp)
    });
    if s.protocol == Protocol::Ftps {
        ftp = ftp.into_secure(tls()?, host).map_err(|e| match e {
            FtpError::UnexpectedResponse(_) => Failure::Fatal(format!("{host} doesn’t accept FTPS on port {}. Try FTP, or implicit FTPS on port 990.", s.port)),
            e => Failure::Fatal(format!("Couldn’t secure the connection to {host}: {}", server_says(&e))),
        })?;
    }
    if s.protocol == Protocol::FtpsImplicit {
        // The library only does this for explicit FTPS; without it, data transfers are refused.
        for cmd in ["PBSZ 0", "PROT P"] {
            ftp.custom_command(cmd, &[Status::CommandOk]).map_err(|e| classify(e, "Couldn’t secure file transfers"))?;
        }
    }
    if s.passive {
        ftp.set_mode(Mode::Passive);
        // Servers behind NAT often announce a private address for passive data; use the real one.
        ftp.set_passive_nat_workaround(true);
    } else {
        ftp = ftp.active_mode(IO_TIMEOUT);
    }

    let user = if s.username.trim().is_empty() { "anonymous" } else { s.username.trim() };
    ftp.login(user, password).map_err(|e| match &e {
        FtpError::UnexpectedResponse(r) if r.status == Status::NotLoggedIn || r.status.code() == 530 => {
            Failure::Fatal(format!("{host} didn’t accept the username or password"))
        }
        _ => classify(e, "Couldn’t sign in"),
    })?;
    ftp.transfer_type(FileType::Binary).map_err(|e| classify(e, "Couldn’t switch to binary mode"))?;
    change_dir(&mut ftp, &s.remote_dir)?;
    Ok(ftp)
}

/// Goes to `dir`, creating any missing folders on the way.
fn change_dir(ftp: &mut FtpStream, dir: &str) -> Result<(), Failure> {
    let dir = dir.trim().replace('\\', "/");
    if dir.is_empty() || dir == "." {
        return Ok(());
    }
    if ftp.cwd(&dir).is_ok() {
        return Ok(());
    }
    if dir.starts_with('/') {
        ftp.cwd("/").map_err(|e| classify(e, "Couldn’t open the server’s top folder"))?;
    }
    for part in dir.split('/').filter(|p| !p.is_empty()) {
        if ftp.cwd(part).is_err() {
            ftp.mkdir(part)
                .and_then(|_| ftp.cwd(part))
                .map_err(|e| match classify(e, &format!("Couldn’t open or create the folder “{dir}”")) {
                    Failure::Refused(m) => Failure::Fatal(m),
                    other => other,
                })?;
        }
    }
    Ok(())
}

fn password_for(server: &Server, typed: Option<String>) -> Result<String, String> {
    if let Some(p) = typed.filter(|p| !p.is_empty()) {
        return Ok(p);
    }
    if server.username.trim().is_empty() {
        return Ok("anonymous@".into());
    }
    Ok(stored_password(&server.id)?.unwrap_or_default())
}

/// Connects, signs in and opens the folder, then disconnects. `password` is what the user just
/// typed, if anything; otherwise the saved one is used.
#[tauri::command]
pub async fn ftp_test(server: Server, password: Option<String>) -> Result<String, String> {
    crate::jobs::blocking(move || {
        let password = password_for(&server, password)?;
        let mut ftp = connect(&server, &password).map_err(|f| f.message())?;
        let dir = ftp.pwd().unwrap_or_else(|_| server.remote_dir.clone());
        let secure = if server.protocol == Protocol::Ftp { "" } else { " securely" };
        let _ = ftp.quit();
        Ok(format!("Connected{secure} to {}. Photos will go to {dir}", server.host.trim()))
    })
    .await
}

// MARK: - Sending

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendJob {
    pub id: String,
    pub server: Server,
    pub files: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub job_id: String,
    pub files_done: usize,
    pub files_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub current_file: String,
    /// "connecting", "sending" or "retrying".
    pub state: &'static str,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub job_id: String,
    pub sent: usize,
    pub skipped: usize,
    /// Files sent under a new name because the original was taken: [original, sent as].
    pub renamed: Vec<(String, String)>,
    pub bytes: u64,
    pub errors: Vec<String>,
    pub cancelled: bool,
}

static CANCELLED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
/// One send at a time: a second one waits for the connection to free up.
static SENDING: Mutex<()> = Mutex::new(());

fn is_cancelled(job: &str) -> bool {
    CANCELLED.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|s| s.contains(job))
}

#[tauri::command]
pub fn ftp_cancel(job_id: String) {
    CANCELLED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashSet::new).insert(job_id);
}

#[tauri::command]
pub fn ftp_send(app: AppHandle, job: SendJob) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _one_at_a_time = SENDING.lock().unwrap_or_else(|e| e.into_inner());
        // Let caption saves that were queued before the send finish writing first.
        drop(crate::jobs::WRITES.lock().unwrap_or_else(|e| e.into_inner()));
        let id = job.id.clone();
        let summary = match password_for(&job.server, None) {
            Ok(password) => run(&job, &password, |p| {
                let _ = app.emit("ftp-progress", p);
            }),
            Err(e) => Summary { job_id: id.clone(), errors: vec![e], ..Default::default() },
        };
        if let Some(set) = CANCELLED.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            set.remove(&id);
        }
        let _ = app.emit("ftp-done", summary);
    });
    Ok(())
}

/// Counts bytes as the FTP library reads the file, and stops the transfer when cancelled.
struct Metered<'a, R: Read> {
    inner: R,
    on_read: &'a mut dyn FnMut(u64) -> bool,
}

impl<R: Read> Read for Metered<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        if !(self.on_read)(n as u64) {
            return Err(std::io::Error::other("stopped"));
        }
        Ok(n)
    }
}

/// The remote name to use for `name`, or None to skip it.
fn remote_name(ftp: &mut FtpStream, name: &str, rule: IfExists) -> Result<Option<String>, Failure> {
    if rule == IfExists::Replace {
        return Ok(Some(name.to_string()));
    }
    // SIZE answers 550 for a missing file. Drop boxes that refuse SIZE (500/502) can't be checked,
    // so the photo is simply sent.
    let exists = |ftp: &mut FtpStream, n: &str| match ftp.size(n) {
        Ok(_) => Ok(true),
        Err(FtpError::UnexpectedResponse(r)) if r.status.code() >= 500 => Ok(false),
        Err(e) => Err(classify(e, "Couldn’t check the server’s folder")),
    };
    if !exists(ftp, name)? {
        return Ok(Some(name.to_string()));
    }
    if rule == IfExists::Skip {
        return Ok(None);
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..1000 {
        let candidate = format!("{stem}-{n}{ext}");
        if !exists(ftp, &candidate)? {
            return Ok(Some(candidate));
        }
    }
    Err(Failure::Refused(format!("{name}: too many files with this name on the server")))
}

/// Sends every file in `job`, reporting progress through `emit`. Separate from Tauri for tests.
pub fn run(job: &SendJob, password: &str, mut emit: impl FnMut(&Progress)) -> Summary {
    let mut summary = Summary { job_id: job.id.clone(), ..Default::default() };
    let files: Vec<(&str, u64)> = job
        .files
        .iter()
        .filter_map(|f| match std::fs::metadata(f) {
            Ok(m) if m.is_file() => Some((f.as_str(), m.len())),
            // A RAW's sidecar is listed whether or not it exists yet.
            _ if f.to_ascii_lowercase().ends_with(".xmp") => None,
            _ => {
                summary.errors.push(format!("{}: the file is missing", file_name(f)));
                None
            }
        })
        .collect();
    let mut progress = Progress {
        job_id: job.id.clone(),
        files_done: 0,
        files_total: files.len(),
        bytes_done: 0,
        bytes_total: files.iter().map(|f| f.1).sum(),
        current_file: String::new(),
        state: "connecting",
        message: None,
    };
    emit(&progress);

    let mut conn: Option<FtpStream> = None;
    let mut last_emit = Instant::now();
    'files: for (path, size) in &files {
        let name = file_name(path);
        progress.current_file = name.clone();
        let start_bytes = progress.bytes_done;
        let mut attempt = 0;
        loop {
            if is_cancelled(&job.id) {
                summary.cancelled = true;
                break 'files;
            }
            let result = (|| -> Result<Option<String>, Failure> {
                if conn.is_none() {
                    progress.state = "connecting";
                    emit(&progress);
                    conn = Some(connect(&job.server, password)?);
                }
                let ftp = conn.as_mut().unwrap();
                let Some(remote) = remote_name(ftp, &name, job.server.if_exists)? else { return Ok(None) };
                progress.state = "sending";
                progress.message = None;
                emit(&progress);
                let file = std::fs::File::open(path).map_err(|e| Failure::Refused(format!("{name}: {e}")))?;
                let job_id = job.id.as_str();
                let mut on_read = |n: u64| {
                    progress.bytes_done += n;
                    if last_emit.elapsed() >= Duration::from_millis(150) {
                        last_emit = Instant::now();
                        emit(&progress);
                    }
                    !is_cancelled(job_id)
                };
                let mut reader = Metered { inner: std::io::BufReader::with_capacity(256 * 1024, file), on_read: &mut on_read };
                match ftp.put_file(&remote, &mut reader) {
                    Ok(_) => Ok(Some(remote)),
                    Err(_) if is_cancelled(job_id) => Err(Failure::Cancelled),
                    Err(e) => Err(classify(e, &format!("{name} didn’t send"))),
                }
            })();

            match result {
                Ok(Some(remote)) => {
                    summary.sent += 1;
                    summary.bytes += size;
                    if remote != name {
                        summary.renamed.push((name.clone(), remote));
                    }
                    break;
                }
                Ok(None) => {
                    summary.skipped += 1;
                    progress.bytes_done = start_bytes + size;
                    break;
                }
                Err(Failure::Cancelled) => {
                    conn = None;
                    summary.cancelled = true;
                    break 'files;
                }
                Err(Failure::Refused(m)) => {
                    summary.errors.push(m);
                    progress.bytes_done = start_bytes + size;
                    break;
                }
                Err(Failure::Fatal(m)) => {
                    summary.errors.push(m);
                    break 'files;
                }
                Err(Failure::Transient(m)) => {
                    conn = None;
                    progress.bytes_done = start_bytes;
                    attempt += 1;
                    if attempt >= ATTEMPTS {
                        summary.errors.push(format!("{m} (tried {ATTEMPTS} times)"));
                        progress.bytes_done = start_bytes + size;
                        // The server is unreachable: don't grind through every remaining file.
                        if ["Couldn’t connect", "Couldn’t find", "Couldn’t reach"].iter().any(|p| m.starts_with(p)) {
                            break 'files;
                        }
                        break;
                    }
                    progress.state = "retrying";
                    progress.message = Some(m);
                    emit(&progress);
                    // Wait a little longer each time, but stay responsive to Stop.
                    let wait = Instant::now();
                    while wait.elapsed() < Duration::from_secs(2 * attempt as u64) {
                        if is_cancelled(&job.id) {
                            summary.cancelled = true;
                            break 'files;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            }
        }
        progress.files_done += 1;
        emit(&progress);
    }
    if let Some(mut ftp) = conn {
        let _ = ftp.quit();
    }
    summary
}

fn file_name(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Against a local test server, e.g. `python3 -m pyftpdlib -w -p 2121 -u deadlyne -P test`:
    /// `DEADLYNE_FTP=127.0.0.1:2121 cargo test ftp_sends -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn ftp_sends_renames_and_skips() {
        let addr = std::env::var("DEADLYNE_FTP").expect("set DEADLYNE_FTP=host:port");
        let (host, port) = addr.rsplit_once(':').unwrap();
        let dir = std::env::temp_dir().join(format!("deadlyne-ftp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("MCD_0001.JPG");
        let b = dir.join("MCD_0002.JPG");
        std::fs::write(&a, vec![7u8; 3_000_000]).unwrap();
        std::fs::write(&b, b"small").unwrap();
        let files = vec![a.to_string_lossy().to_string(), b.to_string_lossy().to_string()];
        let mut server = Server {
            id: "test".into(),
            protocol: Protocol::Ftp,
            host: host.into(),
            port: port.parse().unwrap(),
            username: "deadlyne".into(),
            remote_dir: format!("deadlyne-test-{}/game one", std::process::id()),
            passive: true,
            if_exists: IfExists::Rename,
        };
        let job = |server: &Server, id: &str| SendJob { id: id.into(), server: server.clone(), files: files.clone() };

        let mut updates = 0;
        let first = run(&job(&server, "1"), "test", |_| updates += 1);
        println!("{first:?}");
        assert_eq!((first.sent, first.skipped, first.errors.len()), (2, 0, 0));
        assert!(updates > 3);

        let second = run(&job(&server, "2"), "test", |_| {});
        assert_eq!(second.renamed, vec![("MCD_0001.JPG".into(), "MCD_0001-1.JPG".into()), ("MCD_0002.JPG".into(), "MCD_0002-1.JPG".into())]);

        server.if_exists = IfExists::Skip;
        let third = run(&job(&server, "3"), "test", |_| {});
        assert_eq!((third.sent, third.skipped), (0, 2));

        let bad = run(&job(&server, "4"), "wrong", |_| {});
        assert!(bad.errors[0].contains("username or password"), "{bad:?}");

        ftp_cancel("5".into());
        let stopped = run(&job(&server, "5"), "test", |_| {});
        assert!(stopped.cancelled && stopped.sent == 0);
        // Nothing listening: three tries, then the rest of the send stops instead of grinding on.
        server.port = 1;
        let down = run(&job(&server, "6"), "test", |_| {});
        assert_eq!((down.sent, down.errors.len()), (0, 1), "{down:?}");
        std::fs::remove_dir_all(dir).ok();
    }

    /// Explicit FTPS sign-in, e.g. against Rebex's public read-only test server:
    /// `DEADLYNE_FTPS=test.rebex.net:21:demo:password cargo test ftps_connects -- --ignored`
    #[test]
    #[ignore]
    fn ftps_connects() {
        let v = std::env::var("DEADLYNE_FTPS").expect("set DEADLYNE_FTPS=host:port:user:password");
        let parts: Vec<&str> = v.splitn(4, ':').collect();
        for (protocol, port) in [(Protocol::Ftps, parts[1].parse().unwrap()), (Protocol::FtpsImplicit, 990)] {
            let server = Server {
                id: "t".into(),
                protocol,
                host: parts[0].into(),
                port,
                username: parts[2].into(),
                remote_dir: String::new(),
                passive: true,
                if_exists: IfExists::Rename,
            };
            let mut ftp = connect(&server, parts[3]).map_err(|f| f.message()).unwrap();
            println!("{protocol:?}: {:?} {:?}", ftp.pwd(), ftp.nlst(None).map(|l| l.len()));
            ftp.quit().unwrap();
        }
    }
}
