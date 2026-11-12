/** Set by the store build script and checked against the native build's Cargo features. */
export const isMacAppStore = import.meta.env.VITE_APP_CHANNEL === "mac-app-store"
