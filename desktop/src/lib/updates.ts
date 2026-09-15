// Self-updating: checks GitHub Releases for a newer signed build and installs it on request.
import { relaunch } from "@tauri-apps/plugin-process"
import { check } from "@tauri-apps/plugin-updater"
import { toast } from "sonner"

let checking = false

/** `quiet` checks (at launch) say nothing unless an update exists. */
export async function checkForUpdates({ quiet }: { quiet: boolean }) {
  if (checking || import.meta.env.DEV) {
    if (!quiet && import.meta.env.DEV) toast("Updates are checked in installed builds, not while developing.")
    return
  }
  checking = true
  try {
    const update = await check()
    if (!update) {
      if (!quiet) toast.success("Deadlyne is up to date")
      return
    }
    toast(`Deadlyne ${update.version} is available`, {
      description: update.body?.split("\n")[0] || "Restart to get the latest version.",
      duration: Infinity,
      action: {
        label: "Update",
        onClick: () => {
          const id = toast.loading("Downloading update…")
          update
            .downloadAndInstall()
            .then(() => relaunch())
            .catch((e) => toast.error("The update didn’t install", { id, description: String(e) }))
        },
      },
    })
  } catch (e) {
    if (!quiet) toast.error("Couldn’t check for updates", { description: String(e) })
  } finally {
    checking = false
  }
}
