// A separate store channel: no GitHub updater, explicit sandbox grants, private signing inputs,
// monotonically assigned bundle builds, isolated build output and a verified signed package.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { automaticStoreExport } from "./sign-mac-store.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(root)
const args = process.argv.slice(2)
const check = args.includes("--check")
const automatic = !check && args.includes("--automatic")
const option = (name, fallback) => {
  const at = args.indexOf(name)
  if (at < 0) return fallback
  assert.ok(args[at + 1] && !args[at + 1].startsWith("--"), `Provide a value for ${name}`)
  return args[at + 1]
}
if (args.includes("--help")) {
  console.log(`Mac App Store build
  npm run build:store:check             Sandboxed local verification app, separate data/container
  npm run build:store -- --build-number 1
  npm run build:store -- --automatic --team YOURTEAMID --build-number 1

Signed package inputs (keep private):
  DEADLYNE_STORE_PROFILE                Path to Deadlyne's Mac App Store Connect provisioning profile
  DEADLYNE_STORE_APP_IDENTITY           Installed Apple Distribution / Mac App Distribution identity
  DEADLYNE_STORE_INSTALLER_IDENTITY     Installed Mac Installer Distribution identity
  DEADLYNE_STORE_BUILD_NUMBER           Default bundle build number (or --build-number)

Targets: --target universal-apple-darwin (signed default), aarch64-apple-darwin, x86_64-apple-darwin.
The check build defaults to the host architecture. It cannot be submitted to Apple.
The signed build packages locally; it does not upload or submit for review.`)
  process.exit(0)
}
assert.equal(process.platform, "darwin", "Mac App Store builds require macOS and Xcode")
if (existsSync(".env.local")) process.loadEnvFile(".env.local")
const identifier = check ? "app.deadlyne.store-check" : "app.deadlyne.desktop"
const productName = check ? "Deadlyne Store Check" : "Deadlyne"
const version = JSON.parse(readFileSync("package.json", "utf8")).version
const buildNumber = option("--build-number", process.env.DEADLYNE_STORE_BUILD_NUMBER ?? "1")
assert.match(buildNumber, /^[1-9]\d{0,3}(?:\.\d{1,2}){0,2}$/, "Use an Apple bundle build number such as 1, 2, or 1.1; increase it for each submission")
const target = option("--target", check ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin` : "universal-apple-darwin")
assert.ok(["universal-apple-darwin", "aarch64-apple-darwin", "x86_64-apple-darwin"].includes(target), "Unsupported store target")
const url = new URL(process.env.VITE_SUPABASE_URL ?? "https://missing.invalid")
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
assert.ok(url.protocol === "https:" && url.hostname !== "missing.invalid" && publicKey, "Configure the HTTPS account URL and publishable key in .env.local or the build environment")
assert.ok(!publicKey.startsWith("sb_secret_"), "Only a publishable key may enter the app")
if (publicKey.startsWith("eyJ")) {
  const payload = JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString())
  assert.equal(payload.role, "anon", "Only an anon/publishable account key may enter the app")
}
const out = resolve(".verification/mac-app-store", check ? "check" : "signed")
mkdirSync(out, { recursive: true })
const targetDir = resolve("src-tauri/target/mac-app-store")
const run = (program, parameters, extra = {}) => {
  const result = spawnSync(program, parameters, { stdio: "inherit", ...extra })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${program} failed`)
}
function plist(input) {
  return JSON.parse(execFileSync("python3", ["-c", "import sys,plistlib,json; print(json.dumps(plistlib.loads(sys.stdin.buffer.read()),default=str))"], { input, encoding: "utf8" }))
}
let identity = "-"
let installerIdentity
let profilePath
let entitlements = readFileSync("src-tauri/Entitlements.appstore.plist", "utf8")
if (!check && !automatic) {
  profilePath = process.env.DEADLYNE_STORE_PROFILE && resolve(process.env.DEADLYNE_STORE_PROFILE)
  identity = process.env.DEADLYNE_STORE_APP_IDENTITY
  installerIdentity = process.env.DEADLYNE_STORE_INSTALLER_IDENTITY
  assert.ok(profilePath && existsSync(profilePath), "Set DEADLYNE_STORE_PROFILE to Deadlyne's Mac App Store Connect .provisionprofile. A profile for another app cannot be used.")
  assert.ok(identity && /^(Apple Distribution:|3rd Party Mac Developer Application:)/.test(identity), "Set DEADLYNE_STORE_APP_IDENTITY to the installed distribution certificate's full name")
  assert.ok(installerIdentity && /^3rd Party Mac Developer Installer:/.test(installerIdentity), "Set DEADLYNE_STORE_INSTALLER_IDENTITY to the installed Mac Installer Distribution certificate's full name")
  const profile = plist(execFileSync("security", ["cms", "-D", "-i", profilePath]))
  const entitlement = profile.Entitlements ?? {}
  const appId = entitlement["com.apple.application-identifier"]
  const team = entitlement["com.apple.developer.team-identifier"]
  assert.ok(appId?.endsWith(`.${identifier}`) && profile.TeamIdentifier?.includes(team), "The provisioning profile must belong to app.deadlyne.desktop and its distribution team")
  assert.ok(profile.Platform?.includes("OSX") && !profile.ProvisionedDevices && !profile.ProvisionsAllDevices && !entitlement["get-task-allow"], "Use a Mac App Store Connect distribution profile, not development or Developer ID")
  assert.ok(Date.parse(profile.ExpirationDate + (profile.ExpirationDate.endsWith("Z") ? "" : "Z")) > Date.now(), "The provisioning profile has expired")
  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" })
  const installers = execFileSync("security", ["find-identity", "-v", "-p", "basic"], { encoding: "utf8" })
  assert.ok(identities.includes(`"${identity}"`) && installers.includes(`"${installerIdentity}"`), "Install the distribution certificates with their private keys in Keychain first")
  const xml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  entitlements = entitlements.replace("</dict>", `<key>com.apple.application-identifier</key><string>${xml(appId)}</string>
<key>com.apple.developer.team-identifier</key><string>${xml(team)}</string>
<key>keychain-access-groups</key><array><string>${xml(appId)}</string></array>
${entitlement["beta-reports-active"] ? "<key>beta-reports-active</key><true/>" : ""}
</dict>`)
}
const entitlementPath = join(out, "Entitlements.plist")
writeFileSync(entitlementPath, entitlements)
const base = JSON.parse(readFileSync("src-tauri/tauri.appstore.conf.json", "utf8"))
base.identifier = identifier
base.productName = productName
base.app.security.csp = base.app.security.csp.replace("https://*.supabase.co wss://*.supabase.co", `${url.origin} ${url.origin.replace("https:", "wss:")}`)
base.bundle.macOS = { ...base.bundle.macOS, signingIdentity: identity, entitlements: entitlementPath, bundleVersion: buildNumber, ...(profilePath ? { files: { "embedded.provisionprofile": profilePath } } : {}) }
const config = join(out, "tauri.store.generated.json")
writeFileSync(config, JSON.stringify(base, null, 2))
const env = { ...process.env, VITE_APP_CHANNEL: "mac-app-store", CARGO_TARGET_DIR: targetDir,
  CARGO_PROFILE_RELEASE_DEBUG: "1", CARGO_PROFILE_RELEASE_STRIP: "none", CARGO_PROFILE_RELEASE_SPLIT_DEBUGINFO: "packed" }
// Do not run the direct-download notarization flow for a Mac App Store package.
for (const key of ["APPLE_ID", "APPLE_PASSWORD", "APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PATH"]) delete env[key]
const tree = execFileSync("cargo", ["tree", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--no-default-features", "--features", "mac-app-store", "--target", target === "universal-apple-darwin" ? "aarch64-apple-darwin" : target, "--edges", "normal"], { env, encoding: "utf8" })
assert.ok(!/tauri-plugin-(updater|process|notification)\s|mac-notification-sys\s/.test(tree), "Store dependency graph contains an updater, restart API or legacy notification backend")
run("npx", ["tauri", "build", "--features", "mac-app-store", "--target", target, "--bundles", "app", "--config", config, "--", "--no-default-features", "--locked"], { env })
const app = join(targetDir, target, "release/bundle/macos", `${productName}.app`)
assert.ok(existsSync(app), "The expected store app was not produced")
run("codesign", ["--verify", "--deep", "--strict", app])
const signed = plist(execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { stdio: ["ignore", "pipe", "pipe"] }))
for (const key of ["com.apple.security.app-sandbox", "com.apple.security.files.user-selected.read-write", "com.apple.security.files.bookmarks.app-scope", "com.apple.security.network.client", "com.apple.security.network.server"]) assert.equal(signed[key], true, `Missing entitlement ${key}`)
assert.ok(!signed["com.apple.security.get-task-allow"] && !signed["get-task-allow"], "Store app permits debugger access")
const info = plist(readFileSync(join(app, "Contents/Info.plist")))
assert.equal(info.CFBundleIdentifier, identifier)
assert.equal(info.CFBundleVersion, buildNumber)
const binary = join(app, "Contents/MacOS", info.CFBundleExecutable)
const arch = execFileSync("lipo", ["-archs", binary], { encoding: "utf8" }).trim()
assert.ok(target !== "universal-apple-darwin" || arch.includes("arm64") && arch.includes("x86_64"), "Universal store app is missing an architecture")
const bytes = readFileSync(binary)
for (const token of ["plugin:updater|", "latest/download/latest.json", "updater:allow-check", "downloadAndInstall", "_identityImageHasBorder", "_alwaysShowAlternateActionMenu"]) assert.ok(!bytes.includes(Buffer.from(token)), `Unexpected updater/private API marker in store bundle: ${token}`)
let pkg = null
let archive = null
let distributionApp = null
if (automatic) {
  const exported = automaticStoreExport({ app, team: option("--team", process.env.DEADLYNE_STORE_TEAM), out, entitlements: entitlementPath, targetDir })
  pkg = exported.pkg
  archive = exported.archive
} else if (!check) {
  assert.equal(signed["com.apple.application-identifier"], plist(execFileSync("security", ["cms", "-D", "-i", profilePath])).Entitlements["com.apple.application-identifier"])
  pkg = join(out, `Deadlyne-${version}-${buildNumber}-${target}.pkg`)
  run("productbuild", ["--component", app, "/Applications", "--sign", installerIdentity, pkg])
  run("pkgutil", ["--check-signature", pkg])
}
if (pkg) {
  const signature = execFileSync("pkgutil", ["--check-signature", pkg], { encoding: "utf8" })
  assert.match(signature, /3rd Party Mac Developer Installer:/, "Package is not signed for Mac App Store installation")
  const inspected = join(mkdtempSync(join(out, "verified-payload-")), "expanded")
  run("pkgutil", ["--expand-full", pkg, inspected])
  const findApps = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    return entry.isDirectory() ? entry.name.endsWith(".app") ? [path] : findApps(path) : []
  })
  const apps = findApps(inspected)
  assert.equal(apps.length, 1, "Installer must contain exactly the Deadlyne app")
  distributionApp = apps[0]
  run("codesign", ["--verify", "--deep", "--strict", distributionApp])
  // codesign writes its signature description to stderr.
  const details = spawnSync("codesign", ["-dvv", distributionApp], { encoding: "utf8" })
  assert.equal(details.status, 0)
  assert.match(details.stderr, /Authority=(Apple Distribution:|3rd Party Mac Developer Application:)/)
  const actual = plist(execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", distributionApp], { stdio: ["ignore", "pipe", "pipe"] }))
  const embedded = plist(execFileSync("security", ["cms", "-D", "-i", join(distributionApp, "Contents/embedded.provisionprofile")]))
  const team = embedded.Entitlements["com.apple.developer.team-identifier"]
  assert.equal(embedded.Entitlements["com.apple.application-identifier"], `${team}.${identifier}`)
  assert.equal(actual["com.apple.application-identifier"], `${team}.${identifier}`)
  assert.equal(actual["com.apple.developer.team-identifier"], team)
  assert.ok(embedded.Platform.includes("OSX") && !embedded.ProvisionedDevices && !embedded.ProvisionsAllDevices)
  assert.ok(Date.parse(embedded.ExpirationDate + (embedded.ExpirationDate.endsWith("Z") ? "" : "Z")) > Date.now())
  for (const key of ["com.apple.security.app-sandbox", "com.apple.security.files.user-selected.read-write", "com.apple.security.files.bookmarks.app-scope", "com.apple.security.network.client", "com.apple.security.network.server"]) assert.equal(actual[key], true)
  assert.ok(!actual["get-task-allow"] && !actual["com.apple.security.get-task-allow"] && !embedded.Entitlements["get-task-allow"])
  const packagedInfo = plist(readFileSync(join(distributionApp, "Contents/Info.plist")))
  assert.equal(packagedInfo.CFBundleIdentifier, identifier)
  assert.equal(packagedInfo.CFBundleVersion, buildNumber)
  assert.equal(packagedInfo.CFBundleShortVersionString, version)
  const packagedBinary = join(distributionApp, "Contents/MacOS", packagedInfo.CFBundleExecutable)
  assert.equal(execFileSync("lipo", ["-archs", packagedBinary], { encoding: "utf8" }).trim(), arch)
  const uuids = (path) => execFileSync("dwarfdump", ["--uuid", path], { encoding: "utf8" }).split("\n").filter(Boolean).map((line) => line.match(/^UUID: ([A-F0-9-]+) \(([^)]+)\)/)?.slice(1).join(":"))
  assert.deepEqual(uuids(packagedBinary), uuids(binary), "Xcode's exported executable differs from the Tauri build")
}
writeFileSync(join(out, "build-report.json"), JSON.stringify({ channel: "mac-app-store", submitReadySignature: !check, version, buildNumber, identifier, architectures: arch, sandbox: true, updater: false, app: distributionApp ?? app, sourceApp: app, pkg, packageSha256: pkg ? createHash("sha256").update(readFileSync(pkg)).digest("hex") : null, archive }, null, 2))
console.log(check ? `Sandboxed verification app ready: ${app}\nThis ad-hoc check build cannot be submitted to Apple.` : `Signed Mac App Store package ready: ${pkg}\nNot uploaded or submitted for review.`)
