//! Lookup files for code replacements: tab-delimited rosters where each line is a code and one
//! or more expansion columns (`f10⇥Jordan Sample (10)⇥Fairborn Skyhawks⇥quarterback`).
//!
//! They live in `<app data>/Deadlyne/Code Replacements/` (on macOS the same folder the original
//! Swift app uses, so both apps share rosters). Photo Mechanic files work as-is. The typing
//! engine itself runs in the interface (`src/lib/codes.ts`) so expansion is instant.

use crate::jobs;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const DELIMITERS: &str = "=\\;~`|^";
const EXTENSIONS: [&str; 4] = ["txt", "tsv", "tab", "csv"];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodeList {
    pub file_name: String,
    pub name: String,
    /// Lines starting with `#`, kept at the top of the file.
    pub comments: Vec<String>,
    /// `row[0]` is the code; `row[1..]` are expansion columns #1, #2, #3…
    pub rows: Vec<Vec<String>>,
    /// Column names from a spreadsheet header row, when imported.
    #[serde(default)]
    pub header: Vec<String>,
}

pub fn dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Deadlyne").join("Code Replacements")
}

fn to_text(comments: &[String], rows: &[Vec<String>]) -> String {
    let mut lines: Vec<String> = comments.to_vec();
    for row in rows {
        let mut cells: Vec<String> = row.iter().map(|c| c.replace(['\t', '\n', '\r'], " ")).collect();
        while cells.len() > 1 && cells.last().is_some_and(|c| c.trim().is_empty()) {
            cells.pop();
        }
        if cells.iter().any(|c| !c.trim().is_empty()) {
            lines.push(cells.join("\t"));
        }
    }
    lines.join("\n") + "\n"
}

/// Photo Mechanic–compatible: `code<TAB>col1<TAB>col2…`, or `code=expansion` on a line without
/// tabs. Lines starting with `#` are comments.
pub fn parse(text: &str) -> (Vec<String>, Vec<Vec<String>>) {
    let (mut comments, mut rows) = (vec![], vec![]);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            comments.push(trimmed.to_string());
            continue;
        }
        let mut cells: Vec<String> = if line.contains('\t') {
            line.split('\t').map(|c| c.trim().to_string()).collect()
        } else if let Some((code, rest)) = line.split_once('=') {
            vec![code.trim().to_string(), rest.trim().to_string()]
        } else {
            vec![trimmed.to_string()]
        };
        // Photo Mechanic lists sometimes wrap codes in their delimiter.
        cells[0] = cells[0].trim_matches(|c| DELIMITERS.contains(c)).to_string();
        while cells.len() > 1 && cells.last().is_some_and(|c| c.is_empty()) {
            cells.pop();
        }
        rows.push(cells);
    }
    (comments, rows)
}

/// Decodes text in whatever encoding a spreadsheet or website saved it in.
fn decode(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        let le = bytes[0] == 0xFF;
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        return String::from_utf16_lossy(&units);
    }
    let b = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    String::from_utf8(b.to_vec()).unwrap_or_else(|_| b.iter().map(|&c| cp1252(c)).collect())
}

/// Windows-1252 (what Excel on Windows saves "Text" as) to Unicode.
fn cp1252(c: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž', '\u{8F}', '\u{90}', '‘', '’', '“',
        '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}', 'ž', 'Ÿ',
    ];
    if (0x80..0xA0).contains(&c) { HIGH[(c - 0x80) as usize] } else { c as char }
}

fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let (mut rows, mut row, mut cell) = (vec![], vec![], String::new());
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cell.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                cell.push(c);
            }
            continue;
        }
        match c {
            '"' => quoted = true,
            ',' => row.push(std::mem::take(&mut cell)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            _ => cell.push(c),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows
}

fn read_file(path: &Path) -> std::io::Result<(Vec<String>, Vec<Vec<String>>)> {
    let text = decode(&std::fs::read(path)?);
    let is_csv = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("csv"));
    if !is_csv {
        return Ok(parse(&text));
    }
    let rows = parse_csv(&text)
        .into_iter()
        .map(|r| {
            let mut cells: Vec<String> = r.iter().map(|c| c.trim().to_string()).collect();
            while cells.len() > 1 && cells.last().is_some_and(|c| c.is_empty()) {
                cells.pop();
            }
            cells
        })
        .filter(|r| r.iter().any(|c| !c.is_empty()))
        .collect();
    Ok((vec![], rows))
}

fn sanitize(name: &str) -> String {
    name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-").trim().trim_matches('.').to_string()
}

fn unique_path(name: &str) -> PathBuf {
    let base = match sanitize(name) {
        s if s.is_empty() => "Untitled".to_string(),
        s => s,
    };
    let mut path = dir().join(format!("{base}.txt"));
    let mut n = 2;
    while path.exists() {
        path = dir().join(format!("{base} {n}.txt"));
        n += 1;
    }
    path
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn load(path: &Path) -> Option<CodeList> {
    let (comments, rows) = read_file(path).ok()?;
    Some(CodeList {
        file_name: file_name(path),
        name: path.file_stem()?.to_string_lossy().to_string(),
        comments,
        rows,
        header: vec![],
    })
}

/// First run on a computer with no rosters: a sample to learn from.
fn seed() {
    let d = dir();
    if d.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&d);
    let sample = "# A sample lookup file. Replace it with your rosters, or import one (a .txt or .csv).\n# Each line: code, Tab, then as many columns as you like. Column #1 is what =code= types.\nf10\tJordan Sample (10)\tFairborn Skyhawks\tquarterback\nf22\tAvery Example (22)\tFairborn Skyhawks\trunning back\nt7\tCasey Placeholder (7)\tTecumseh Arrows\twide receiver\nt73\tRiley Demo (73)\tTecumseh Arrows\toffensive lineman\nfhs\tFairborn High School\nths\tTecumseh High School\n";
    let _ = std::fs::write(d.join("Sample Roster.txt"), sample);
}

// MARK: - Commands

#[tauri::command]
pub async fn code_lists() -> Vec<CodeList> {
    jobs::blocking(|| {
        seed();
        let mut lists: Vec<CodeList> = std::fs::read_dir(dir())
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| {
                        !file_name(p).starts_with('.')
                            && p.extension().is_some_and(|e| EXTENSIONS.iter().any(|x| e.eq_ignore_ascii_case(x)))
                    })
                    .filter_map(|p| load(&p))
                    .collect()
            })
            .unwrap_or_default();
        lists.sort_by_key(|l| l.file_name.to_lowercase());
        lists
    })
    .await
}

#[tauri::command]
pub async fn save_code_list(file_name: String, comments: Vec<String>, rows: Vec<Vec<String>>) -> Result<(), String> {
    jobs::serial(move || {
        let path = dir().join(sanitize(&file_name));
        crate::xmp::write_atomic(&path, to_text(&comments, &rows).as_bytes()).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_code_list(name: String, rows: Vec<Vec<String>>) -> Result<String, String> {
    jobs::serial(move || {
        std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
        let path = unique_path(&name);
        std::fs::write(&path, to_text(&[], &rows)).map_err(|e| e.to_string())?;
        Ok(file_name(&path))
    })
    .await
}

/// Copies rosters into the lookup files folder as tab-delimited UTF-8. A spreadsheet header row
/// ("Code, Name, Team…") becomes the column names instead of a code.
#[tauri::command]
pub async fn import_code_lists(paths: Vec<String>) -> (Vec<CodeList>, Vec<String>) {
    jobs::serial(move || {
        let _ = std::fs::create_dir_all(dir());
        let (mut imported, mut errors) = (vec![], vec![]);
        for p in paths {
            let src = Path::new(&p);
            let (comments, mut rows) = match read_file(src) {
                Ok(r) => r,
                Err(e) => {
                    errors.push(format!("{}: {e}", file_name(src)));
                    continue;
                }
            };
            if rows.is_empty() {
                errors.push(format!("{} doesn’t contain any codes. Each line needs a code, a Tab, then its text.", file_name(src)));
                continue;
            }
            let header_words = ["code", "codes", "shortcut", "key", "#", "no", "no.", "num", "number", "jersey"];
            let mut header = vec![];
            if rows.len() > 1 && header_words.contains(&rows[0][0].to_lowercase().as_str()) {
                header = rows.remove(0).into_iter().skip(1).collect();
            }
            let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Roster".into());
            let path = unique_path(&stem);
            match std::fs::write(&path, to_text(&comments, &rows)) {
                Ok(()) => imported.push(CodeList { file_name: file_name(&path), name: stem, comments, rows, header }),
                Err(e) => errors.push(format!("{}: {e}", file_name(src))),
            }
        }
        (imported, errors)
    })
    .await
}

#[tauri::command]
pub async fn rename_code_list(file_name: String, new_name: String) -> Result<String, String> {
    jobs::serial(move || {
        let from = dir().join(sanitize(&file_name));
        let to = unique_path(&new_name);
        std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
        Ok(self::file_name(&to))
    })
    .await
}

/// Moves a lookup file to the Trash / Recycle Bin (recoverable).
#[tauri::command]
pub async fn trash_code_list(file_name: String) -> Result<(), String> {
    jobs::serial(move || crate::fileops::move_to_trash(&dir().join(sanitize(&file_name))).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub fn code_lists_folder() -> String {
    let _ = std::fs::create_dir_all(dir());
    dir().to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_photo_mechanic_and_csv() {
        let (comments, rows) = parse("# roster\n\\L7\\\tLuka Dončić\tDallas\tguard\r\nths=Tecumseh High School\n\nk9\t\tteam only\t\n");
        assert_eq!(comments, vec!["# roster"]);
        assert_eq!(rows[0], vec!["L7", "Luka Dončić", "Dallas", "guard"]);
        assert_eq!(rows[1], vec!["ths", "Tecumseh High School"]);
        assert_eq!(rows[2], vec!["k9", "", "team only"]);
        assert_eq!(parse_csv("code,name\n10,\"Smith, \"\"Jr\"\"\"\r\n")[1], vec!["10", "Smith, \"Jr\""]);
        assert_eq!(decode(&[0x43, 0x61, 0x66, 0xE9]), "Café");
    }
}
