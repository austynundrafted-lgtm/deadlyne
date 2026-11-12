// Xcode owns registration, managed certificates, provisioning and App Store package signing.
// This generated macOS application target assembles the already-built Tauri binary/resources;
// it neither substitutes a different executable nor uploads the resulting package.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export function automaticStoreExport({ app, team, out, entitlements, targetDir }) {
  assert.match(team ?? "", /^[A-Z0-9]{10}$/, "Provide --team or DEADLYNE_STORE_TEAM with your Apple Developer team ID")
  mkdirSync(out, { recursive: true })
  const folder = mkdtempSync(join(out, "xcode-signing-"))
  const xcodegen = process.env.XCODEGEN ?? (existsSync(join(homedir(), ".local/xcodegen-dl/xcodegen/bin/xcodegen")) ? join(homedir(), ".local/xcodegen-dl/xcodegen/bin/xcodegen") : "xcodegen")
  const spec = {
    name: "DeadlyneStoreDistribution",
    options: { deploymentTarget: { macOS: "12.0" } },
    settings: { base: { DEVELOPMENT_TEAM: team, CODE_SIGN_STYLE: "Automatic", CODE_SIGN_IDENTITY: "Apple Development", ONLY_ACTIVE_ARCH: "NO", ARCHS: "arm64 x86_64" } },
    targets: {
      Deadlyne: {
        type: "application", platform: "macOS", deploymentTarget: "12.0",
        settings: { base: {
          PRODUCT_NAME: "Deadlyne", PRODUCT_BUNDLE_IDENTIFIER: "app.deadlyne.desktop", EXECUTABLE_NAME: "Deadlyne",
          INFOPLIST_FILE: join(app, "Contents/Info.plist"), GENERATE_INFOPLIST_FILE: "NO", CODE_SIGN_ENTITLEMENTS: entitlements,
          ENABLE_APP_SANDBOX: "YES", ENABLE_HARDENED_RUNTIME: "YES", CODE_SIGN_INJECT_BASE_ENTITLEMENTS: "YES",
          SKIP_INSTALL: "NO", INSTALL_PATH: "$(LOCAL_APPS_DIR)", STRIP_INSTALLED_PRODUCT: "NO", COPY_PHASE_STRIP: "NO",
          // This is Xcode's build-script sandbox, separate from the shipped app's App Sandbox.
          ENABLE_USER_SCRIPT_SANDBOXING: "NO", DEADLYNE_STORE_SOURCE_APP: app,
        } },
        postCompileScripts: [{
          name: "Assemble the verified Tauri application", basedOnDependencyAnalysis: false,
          script: 'set -eu\nmkdir -p "${TARGET_BUILD_DIR}/${EXECUTABLE_FOLDER_PATH}"\n/usr/bin/ditto "${DEADLYNE_STORE_SOURCE_APP}/Contents/MacOS/Deadlyne" "${TARGET_BUILD_DIR}/${EXECUTABLE_PATH}"\n/usr/bin/ditto "${DEADLYNE_STORE_SOURCE_APP}/Contents/Resources" "${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"\n',
          inputFiles: [join(app, "Contents/MacOS/Deadlyne"), join(app, "Contents/Resources")],
          outputFiles: ["$(TARGET_BUILD_DIR)/$(EXECUTABLE_PATH)", "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)"],
        }],
      },
    },
    schemes: { Deadlyne: { build: { targets: { Deadlyne: "all" } }, archive: { config: "Release" } } },
  }
  const specPath = join(folder, "project.json")
  writeFileSync(specPath, JSON.stringify(spec, null, 2))
  execFileSync(xcodegen, ["generate", "--spec", specPath, "--project", folder], { stdio: "inherit" })
  const run = (args, name) => {
    const log = join(folder, `${name}.log`), fd = openSync(log, "w")
    console.log(`Xcode ${name}: ${log}`)
    const result = spawnSync("xcodebuild", args, { stdio: ["ignore", fd, fd] })
    closeSync(fd)
    const lines = readFileSync(log, "utf8").split("\n")
    if (result.error || result.status !== 0) {
      console.error(lines.slice(-65).join("\n"))
      throw result.error ?? new Error(`Xcode ${name} failed; see ${log}`)
    }
    console.log(lines.filter((line) => /ARCHIVE SUCCEEDED|EXPORT SUCCEEDED|Exported/.test(line)).join("\n"))
  }
  const archive = join(folder, "Deadlyne.xcarchive")
  run(["-project", join(folder, "DeadlyneStoreDistribution.xcodeproj"), "-scheme", "Deadlyne", "-configuration", "Release", "-destination", "generic/platform=macOS", "-archivePath", archive, "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration", "archive"], "archive")
  // Rust creates each dSYM while its temporary objects are still available. Xcode assembles
  // the prebuilt universal executable, so combine Rust's two symbol files into one bundle.
  const binary = join(archive, "Products/Applications/Deadlyne.app/Contents/MacOS/Deadlyne")
  const dsym = join(archive, "dSYMs/Deadlyne.app.dSYM")
  mkdirSync(join(archive, "dSYMs"), { recursive: true })
  const inputs = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map((arch) => join(targetDir, arch, "release/Deadlyne.dSYM"))
  for (const input of inputs) assert.ok(existsSync(input), `Missing Rust debug symbols: ${input}`)
  const symbolFiles = inputs.map((input) => {
    const folder = join(input, "Contents/Resources/DWARF"), files = readdirSync(folder)
    assert.equal(files.length, 1, `Expected one Rust symbol file in ${input}`)
    return join(folder, files[0])
  })
  execFileSync("ditto", [inputs[0], dsym])
  const dwarf = join(dsym, "Contents/Resources/DWARF/Deadlyne")
  for (const file of readdirSync(join(dsym, "Contents/Resources/DWARF"))) unlinkSync(join(dsym, "Contents/Resources/DWARF", file))
  execFileSync("lipo", ["-create", ...symbolFiles, "-output", dwarf])
  const uuids = (path) => execFileSync("dwarfdump", ["--uuid", path], { encoding: "utf8" }).split("\n").filter(Boolean).map((line) => line.match(/^UUID: ([A-F0-9-]+) \(([^)]+)\)/)?.slice(1).join(":"))
  const executableUuids = uuids(binary).sort(), symbolUuids = uuids(dsym).sort()
  assert.equal(executableUuids.length, 2, "Expected a universal executable")
  assert.deepEqual(symbolUuids, executableUuids, "Archive dSYM does not match the executable")
  for (const arch of ["arm64", "x86_64"]) {
    const stats = JSON.parse(execFileSync("xcrun", ["dwarfdump", "--statistics", `--arch=${arch}`, dwarf], { encoding: "utf8" }))
    assert.ok(stats["#functions with location"] > 0, `${arch} dSYM contains no source locations`)
  }
  const options = join(folder, "ExportOptions.plist")
  writeFileSync(options, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>destination</key><string>export</string><key>signingStyle</key><string>automatic</string><key>teamID</key><string>${team}</string><key>manageAppVersionAndBuildNumber</key><false/><key>uploadSymbols</key><true/></dict></plist>`)
  const exported = join(folder, "export")
  run(["-exportArchive", "-archivePath", archive, "-exportPath", exported, "-exportOptionsPlist", options, "-allowProvisioningUpdates"], "export")
  const packages = readdirSync(exported).filter((file) => file.endsWith(".pkg"))
  assert.equal(packages.length, 1, "Xcode did not export exactly one Mac App Store installer")
  const pkg = join(exported, packages[0])
  execFileSync("pkgutil", ["--check-signature", pkg], { stdio: "inherit" })
  return { pkg, archive }
}
