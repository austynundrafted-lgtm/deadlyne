// Store updates are delivered by Apple. Vite substitutes this module for the direct-download
// updater at build time, so no updater client, download code or restart API enters the bundle.
export async function checkForUpdates(_options: { quiet: boolean }): Promise<void> {}
