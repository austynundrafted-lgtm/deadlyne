// Sets the app version everywhere it's recorded: `npm run release -- 0.2.0`
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: npm run release -- <major.minor.patch>")
  process.exit(1)
}
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, "utf8")))
edit("package.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`))
edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`))
edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`))
// Let npm bring the lockfile's own name and version in line with package.json.
execSync("npm install --package-lock-only --ignore-scripts --no-audit --no-fund", { stdio: "ignore" })
console.log(`Deadlyne is now ${version}. Next:
  git commit -am "Deadlyne ${version}"
  git tag desktop-v${version} && git push origin main desktop-v${version}`)
