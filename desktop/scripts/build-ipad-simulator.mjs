// Build bundled iPad assets through Tauri, then let Xcode target the installed simulator SDK.
// This avoids Tauri's requirement for a simulator runtime matching the SDK's exact version.
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const desktop = fileURLToPath(new URL("../", import.meta.url))
const apple = path.join(desktop, "src-tauri/gen/apple")
const derived = path.join(apple, "build/simulator")
const tauri = spawn(process.execPath, [
  path.join(desktop, "node_modules/@tauri-apps/cli/tauri.js"),
  "ios", "build", "--open", "--target", "aarch64-sim", "--no-sign",
  "--config", "src-tauri/tauri.local.conf.json",
], { cwd: desktop, stdio: ["ignore", "pipe", "pipe"] })

let xcode
let building = false
let finished = false
let recent = ""

function finish(code) {
  if (finished) return
  finished = true
  xcode?.kill("SIGTERM")
  tauri.kill("SIGTERM")
  process.exitCode = code
}

function output(chunk, stream) {
  stream.write(chunk)
  recent = (recent + chunk.toString()).slice(-2000)
  if (building || !recent.includes("Opening Xcode")) return
  building = true
  xcode = spawn("xcodebuild", [
    "-project", path.join(apple, "deadlyne.xcodeproj"),
    "-scheme", "deadlyne_iOS", "-configuration", "release",
    "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator",
    "-derivedDataPath", derived, "CODE_SIGNING_ALLOWED=NO", "ARCHS=arm64",
    "ONLY_ACTIVE_ARCH=YES", "build",
  ], { cwd: desktop, stdio: "inherit" })
  xcode.on("error", (error) => { console.error(error.message); finish(1) })
  xcode.on("exit", (code) => {
    if (code === 0) console.log(`\niPad Simulator app: ${path.join(derived, "Build/Products/release-iphonesimulator/Deadlyne.app")}`)
    finish(code ?? 1)
  })
}

tauri.stdout.on("data", (chunk) => output(chunk, process.stdout))
tauri.stderr.on("data", (chunk) => output(chunk, process.stderr))
tauri.on("error", (error) => { console.error(error.message); finish(1) })
tauri.on("exit", (code) => {
  if (!finished) {
    console.error("Tauri stopped before the iPad build finished.")
    finish(code || 1)
  }
})
process.on("SIGINT", () => finish(130))
process.on("SIGTERM", () => finish(143))
