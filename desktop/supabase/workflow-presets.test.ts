import { readFileSync, readdirSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const db = new PGlite()
const a = "10000000-0000-4000-8000-000000000001"
const b = "10000000-0000-4000-8000-000000000002"
const options = { folderPattern: "{date}_{job}", renameOn: true, renamePattern: "{job}_{seq}", skipExisting: true, eject: false }
async function asUser(id = a) {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await db.exec("set role authenticated")
}
async function insert(name = "Game night", kind = "ingest", settings: object = options, user = a) {
  return (await db.query<{ id: string; version: number }>("insert into public.workflow_presets(user_id, kind, name, settings) values ($1,$2,$3,$4) returning id,version", [user, kind, name, JSON.stringify(settings)])).rows[0]
}

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;`)
  const folder = new URL("./migrations/", import.meta.url)
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".sql")).sort()) await db.exec(readFileSync(new URL(file, folder), "utf8"))
}, 30000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade;")
  await db.query("insert into auth.users(id,email) values ($1,'owner@example.invalid'),($2,'other@example.invalid')", [a, b])
  await asUser()
})

describe("preset migration against PostgreSQL", () => {
  it("isolates reads, inserts, updates and deletes between two authenticated owners", async () => {
    const row = await insert()
    await asUser(b)
    expect((await db.query("select * from public.workflow_presets")).rows).toEqual([])
    await expect(insert("Forged", "ingest", options, a)).rejects.toThrow(/row-level security/)
    expect((await db.query("update public.workflow_presets set name='Stolen' where id=$1 returning id", [row.id])).rows).toEqual([])
    expect((await db.query("delete from public.workflow_presets where id=$1 returning id", [row.id])).rows).toEqual([])
    await insert("Game night", "ingest", options, b)
    await asUser(a)
    expect((await db.query<{ name: string }>("select name from public.workflow_presets")).rows).toEqual([{ name: "Game night" }])
  })

  it("denies anonymous access and client changes to owner, revision and workflow kind", async () => {
    const row = await insert()
    for (const assignment of [`user_id='${b}'`, "version=99", "kind='export'"]) {
      await expect(db.query(`update public.workflow_presets set ${assignment} where id=$1`, [row.id])).rejects.toThrow(/permission denied/)
    }
    await db.exec("reset role; set role anon")
    await expect(db.query("select * from public.workflow_presets")).rejects.toThrow(/permission denied/)
    await expect(insert()).rejects.toThrow(/permission denied/)
  })

  it("rejects stale updates and stale delete approvals after another device edits", async () => {
    const row = await insert()
    const fresh = await db.query<{ version: number }>("update public.workflow_presets set name='Revised' where id=$1 and version=1 returning version", [row.id])
    expect(fresh.rows[0].version).toBe(2)
    expect((await db.query("update public.workflow_presets set name='Outdated' where id=$1 and version=1 returning id", [row.id])).rows).toEqual([])
    expect((await db.query("delete from public.workflow_presets where id=$1 and version=1 returning id", [row.id])).rows).toEqual([])
  })

  it("rejects nonportable fields, invalid settings and duplicate names", async () => {
    await insert()
    await expect(insert("GAME NIGHT")).rejects.toThrow(/unique constraint/)
    for (const settings of [{ ...options, destination: "/private/client" }, { ...options, skipExisting: null }, { ...options, renamePattern: "private\\path" }, { ...options, folderPattern: "/private/path" }, { ...options, renamePattern: "bad\nname" }]) {
      await expect(insert("Invalid", "ingest", settings)).rejects.toThrow(/check constraint/)
    }
    await expect(insert("Invalid export", "export", { files: "jpeg", longEdge: -1, quality: 88, subfolderOn: true, renameOn: false, renamePattern: "{shoot}_{seq}", openWhenDone: true })).rejects.toThrow(/check constraint/)
    await insert("Originals", "export", { files: "both", longEdge: null, quality: 95, subfolderOn: true, renameOn: false, renamePattern: "{original}", openWhenDone: false })
  })

  it("cascades account deletion through profiles and presets while retaining anonymized receipt proof", async () => {
    await insert()
    await asUser(b)
    await insert("Keep", "ingest", options, b)
    await db.exec("reset role")
    await db.query("insert into public.account_deletion_requests(request_hash,user_id) values ($1,$2)", ["a".repeat(64), a])
    await db.query("delete from auth.users where id=$1", [a])
    expect((await db.query("select * from public.workflow_presets where user_id=$1", [a])).rows).toEqual([])
    expect((await db.query("select * from public.profiles where id=$1", [a])).rows).toEqual([])
    expect((await db.query<{ name: string }>("select name from public.workflow_presets")).rows).toEqual([{ name: "Keep" }])
    const receipt = (await db.query<{ user_id: string | null; completed_at: unknown }>("select user_id,completed_at from public.account_deletion_requests")).rows[0]
    expect(receipt.user_id).toBeNull()
    expect(receipt.completed_at).not.toBeNull()
    const permission = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated', 'public.version_workflow_preset()', 'execute') as allowed")
    expect(permission.rows[0].allowed).toBe(false)
  })
})
