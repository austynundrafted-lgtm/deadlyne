// Explicit integration test: creates and deletes only disposable users made by this run.
// Management credentials stay in this process's memory and are never written to app files.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

assert.equal(process.env.DEADLYNE_ACCOUNT_DELETION_LIVE, "1", "Set DEADLYNE_ACCOUNT_DELETION_LIVE=1 to run disposable-account deletion tests.")
process.loadEnvFile(".env.local")
const url = process.env.VITE_SUPABASE_URL
assert.ok(url, "Configure VITE_SUPABASE_URL first.")
const project = new URL(url).hostname.split(".")[0]
let keys
try {
  keys = JSON.parse(execFileSync("npx", ["supabase", "projects", "api-keys", `--remote=${project}`, "--reveal", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))
} catch {
  // execFile errors can carry stdout. Never print raw API-key command output.
  throw new Error("Supabase management login unavailable. Run npx supabase login in Terminal first.")
}
const secret = keys.find((key) => key.name === "service_role")?.api_key
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
assert.ok(secret && publicKey, "A management login and app publishable key are required.")
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, secret, options)
const original = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
assert.ok(!original.error, "Could not record the original account set.")
const originalIds = original.data.users.map((user) => user.id)
const created = []
const receipts = []
const results = {}
const record = (name, condition) => { assert.ok(condition, name); results[name] = true; console.log(`PASS ${name}`) }
const receipt = () => { const value = randomBytes(32).toString("hex"); receipts.push(value); return value }
const send = async (body, jwt) => {
  const response = await fetch(`${url}/functions/v1/delete-account`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: publicKey, ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}
const tester = async () => {
  const email = `deadlyne-delete-test-${randomUUID()}@example.invalid`
  const password = randomBytes(32).toString("base64url")
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { deadlyne_account_deletion_test: true } })
  assert.ok(!user.error && user.data.user, "Disposable account creation failed.")
  created.push(user.data.user.id)
  const client = createClient(url, publicKey, options)
  const signedIn = await client.auth.signInWithPassword({ email, password })
  assert.ok(!signedIn.error && signedIn.data.session, "Disposable account sign-in failed.")
  const profile = await admin.from("profiles").select("id,status").eq("id", user.data.user.id).single()
  record("new-account-profile-created", !!profile.data?.id && !profile.error)
  await admin.from("profiles").update({ name: "Disposable photographer", credit: "Deletion integration test" }).eq("id", user.data.user.id)
  return { id: user.data.user.id, email, password, client, session: signedIn.data.session }
}

try {
  const a = await tester()
  const b = await tester()
  const portable = { folderPattern: "{date}_{job}", renameOn: true, renamePattern: "{job}_{seq}", skipExisting: true, eject: false }
  const presetA = await a.client.from("workflow_presets").insert({ user_id: a.id, kind: "ingest", name: "Fixture game", settings: portable }).select().single()
  record("account-preset-created", !presetA.error && presetA.data.version === 1)
  const secondDevice = createClient(url, publicKey, options)
  await secondDevice.auth.signInWithPassword({ email: a.email, password: a.password })
  const synced = await secondDevice.from("workflow_presets").select("id,name,settings,version").eq("id", presetA.data.id).single()
  record("preset-follows-account-to-second-session", !synced.error && synced.data.name === "Fixture game")
  const notYours = await b.client.from("workflow_presets").select("id").eq("id", presetA.data.id)
  record("preset-hidden-from-other-account", !notYours.error && notYours.data.length === 0)
  const forgedPreset = await b.client.from("workflow_presets").insert({ user_id: a.id, kind: "ingest", name: "Forged owner", settings: portable })
  record("preset-forged-owner-rejected", !!forgedPreset.error)
  const privatePath = await a.client.from("workflow_presets").insert({ user_id: a.id, kind: "ingest", name: "Forbidden path", settings: { ...portable, destination: "/private/fixture" } })
  record("preset-private-path-rejected-by-server", !!privatePath.error)
  const updated = await secondDevice.from("workflow_presets").update({ name: "Revised fixture" }).eq("id", presetA.data.id).eq("version", 1).select().single()
  record("preset-revision-increments-on-server", !updated.error && updated.data.version === 2)
  const staleEdit = await a.client.from("workflow_presets").update({ name: "Stale fixture" }).eq("id", presetA.data.id).eq("version", 1).select()
  const staleDelete = await a.client.from("workflow_presets").delete().eq("id", presetA.data.id).eq("version", 1).select()
  record("preset-stale-edit-and-delete-rejected", !staleEdit.error && !staleDelete.error && staleEdit.data.length === 0 && staleDelete.data.length === 0)
  const presetB = await b.client.from("workflow_presets").insert({ user_id: b.id, kind: "export", name: "Fixture export", settings: { files: "jpeg", longEdge: 3000, quality: 88, subfolderOn: true, renameOn: true, renamePattern: "{shoot}_{seq}", openWhenDone: false } }).select().single()
  record("account-export-preset-created", !presetB.error && presetB.data.version === 1)
  const secondClient = createClient(url, publicKey, options)
  const secondSession = await secondClient.auth.signInWithPassword({ email: a.email, password: a.password })
  assert.ok(secondSession.data.session, "Second session sign-in failed.")
  const token = receipt()
  const body = { action: "delete", requestToken: token, password: a.password, userId: b.id }
  record("unauthenticated-delete-rejected", (await send(body)).status === 401)
  record("wrong-password-rejected", (await send({ ...body, password: "intentionally-wrong" }, a.session.access_token)).status === 403)
  record("failed-verification-keeps-account", !!(await admin.auth.admin.getUserById(a.id)).data.user)
  const unreadable = await a.client.from("account_deletion_requests").select("request_hash")
  record("receipt-table-not-readable-by-users", !!unreadable.error)
  const oldRPC = await b.client.rpc("delete_own_account")
  record("legacy-deletion-bypass-denied", !!oldRPC.error)

  const deletions = await Promise.all([send(body, a.session.access_token), send(body, a.session.access_token)])
  record("concurrent-repeat-deletions-confirmed", deletions.every((r) => r.status === 200 && r.body.status === "completed"))
  record("auth-user-actually-deleted", !(await admin.auth.admin.getUserById(a.id)).data.user)
  const removedProfile = await admin.from("profiles").select("id").eq("id", a.id)
  record("synced-profile-actually-deleted", !removedProfile.error && removedProfile.data.length === 0)
  const removedPresets = await admin.from("workflow_presets").select("id").eq("user_id", a.id)
  record("account-presets-actually-deleted", !removedPresets.error && removedPresets.data.length === 0)
  const keptPresets = await b.client.from("workflow_presets").select("id").eq("id", presetB.data.id)
  record("other-account-presets-preserved", !keptPresets.error && keptPresets.data.length === 1)
  record("supplied-other-user-id-cannot-delete-another-account", !!(await admin.auth.admin.getUserById(b.id)).data.user)
  const status = await send({ action: "status", requestToken: token })
  record("lost-response-recovered-with-receipt", status.status === 200 && status.body.status === "completed")
  const repeated = await send(body, a.session.access_token)
  record("repeat-after-session-deletion-is-safe", repeated.status === 200 && repeated.body.status === "completed")
  const hash = (await import("node:crypto")).createHash("sha256").update(token).digest("hex")
  const proof = await admin.from("account_deletion_requests").select("user_id,completed_at").eq("request_hash", hash).single()
  record("completion-receipt-has-no-user-link", !proof.error && proof.data.user_id === null && !!proof.data.completed_at)
  record("other-session-access-token-rejected", !!(await secondClient.auth.getUser(secondSession.data.session.access_token)).error)
  record("other-session-refresh-token-rejected", !!(await secondClient.auth.refreshSession({ refresh_token: secondSession.data.session.refresh_token })).error)
  record("original-session-refresh-token-rejected", !!(await a.client.auth.refreshSession({ refresh_token: a.session.refresh_token })).error)
  const staleProfile = await secondClient.from("profiles").select("id").eq("id", a.id)
  record("deleted-session-cannot-read-profile", !!staleProfile.error || staleProfile.data.length === 0)
  record("deleted-credentials-cannot-sign-in", !!(await a.client.auth.signInWithPassword({ email: a.email, password: a.password })).error)

  const bDeletion = await send({ action: "delete", requestToken: receipt(), password: b.password }, b.session.access_token)
  record("pending-account-can-delete-without-approval", bDeletion.status === 200 && bDeletion.body.status === "completed")
  const removedBPresets = await admin.from("workflow_presets").select("id").eq("user_id", b.id)
  record("pending-account-presets-also-deleted", !removedBPresets.error && removedBPresets.data.length === 0)
  for (const id of originalIds) assert.ok((await admin.auth.admin.getUserById(id)).data.user, "An original account was unexpectedly removed.")
  results.existingUsersPreserved = originalIds.length
  results.disposableUsersDeleted = created.length
  writeFileSync("../.verification/account-deletion-live-results.json", JSON.stringify(results, null, 2))
  console.log(`Verified ${Object.keys(results).length - 2} checks; ${originalIds.length} existing users preserved.`)
} finally {
  for (const id of created) {
    const user = await admin.auth.admin.getUserById(id)
    if (user.data.user?.user_metadata.deadlyne_account_deletion_test === true) await admin.auth.admin.deleteUser(id, false)
  }
  const { createHash } = await import("node:crypto")
  const hashes = receipts.map((value) => createHash("sha256").update(value).digest("hex"))
  if (hashes.length) await admin.from("account_deletion_requests").delete().in("request_hash", hashes)
}
