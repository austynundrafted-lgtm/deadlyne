// Restore the generated Xcode project after a clean checkout or build-cache cleanup.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const desktop = fileURLToPath(new URL("../", import.meta.url))
const apple = path.join(desktop, "src-tauri/gen/apple")
const recipe = path.join(apple, "project.yml")
const project = path.join(apple, "deadlyne.xcodeproj/project.pbxproj")

// XcodeGen requires these referenced folders even before Tauri puts files in them.
for (const folder of ["assets", "Externals"]) mkdirSync(path.join(apple, folder), { recursive: true })

if (!existsSync(project) || statSync(recipe).mtimeMs > statSync(project).mtimeMs) {
  const bundled = path.join(homedir(), ".local/xcodegen-dl/xcodegen/bin/xcodegen")
  const result = spawnSync(existsSync(bundled) ? bundled : "xcodegen", ["generate"], { cwd: apple, stdio: "inherit" })
  if (result.error || result.status !== 0) {
    console.error("Could not generate the iPad project. Install XcodeGen, then run npm run ipad:prepare again.")
    process.exit(1)
  }
} else {
  console.log("iPad Xcode project is ready.")
}
