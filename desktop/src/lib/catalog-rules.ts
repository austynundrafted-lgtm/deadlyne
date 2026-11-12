/** Rules are reserved for a future catalog indexer. The closest explicit ancestor wins. */
export type CatalogRule = "include" | "exclude"
export type CatalogRules = Record<string, CatalogRule>

export function catalogPath(path: string): string {
  return path.replace(/[\\/]+$/, "") || path
}

export function effectiveCatalogRule(path: string, rules: CatalogRules): { path: string; rule: CatalogRule } | null {
  const target = catalogPath(path)
  let best: { path: string; rule: CatalogRule } | null = null
  for (const [key, rule] of Object.entries(rules)) {
    const parent = catalogPath(key)
    const prefix = /[\\/]$/.test(parent) ? parent : `${parent}${parent.includes("\\") ? "\\" : "/"}`
    if ((target === parent || target.startsWith(prefix)) && (!best || parent.length > best.path.length)) best = { path: parent, rule }
  }
  return best
}
