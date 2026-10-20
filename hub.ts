// HUAWEI Hub — settings backend for the ⚙️ admin page (/admin).
// Stores the portal menu (apps), the team list (staff + branch) and an edit log.
// Storage: Postgres (DATABASE_URL, one key/value table) — falls back to a JSON
// file when DATABASE_URL is not set (local development).
// Who may edit: only HUB_OWNER_EMAILS (default benyapakamonphan@gmail.com), proven
// by a Google Sign-In ID token verified with Google (same OAuth client as the
// Report Dashboard and the home page).
import { SQL } from "bun"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "777160588326-vrashr368vl4461981rfhmue1dsjcdnf.apps.googleusercontent.com"
const OWNERS = (process.env.HUB_OWNER_EMAILS ?? "benyapakamonphan@gmail.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
// Gmail ignores dots and "+tag" (wetaga.chow@gmail.com == wetagachow@gmail.com): compare that way, so an
// account whose Google token carries the other spelling still matches its entry (same rule as the
// Report Dashboard script v4).
function canonEmail(email: string): string {
  const e = String(email || "").toLowerCase().trim(), at = e.lastIndexOf("@")
  if (at < 0) return e
  let user = e.slice(0, at), domain = e.slice(at + 1)
  if (domain === "gmail.com" || domain === "googlemail.com") { user = user.split("+")[0].replace(/\./g, ""); domain = "gmail.com" }
  return user + "@" + domain
}
const isOwnerEmail = (email: string) => OWNERS.some(o => canonEmail(o) === canonEmail(email))
// Local testing only: accept "dev:<email>" as a token. Never set in production.
const DEV_AUTH = process.env.HUB_DEV_AUTH === "1"
const FILE_STORE = process.env.HUB_STORE_FILE ?? "/tmp/huawei-hub-store.json"

export const BRANCHES: { code: string; name: string }[] = [
  { code: "HES-TMN", name: "The Mall Ngamwongwan" }, { code: "HES-KBI", name: "Central Krabi" },
  { code: "HMD-HKT", name: "Central Festival Phuket" }, { code: "HMD-CCS", name: "Robinson Lifestyle Chachoengsao" },
  { code: "HMD-CWN", name: "Central Chaengwattana" }, { code: "HMD-EMQ", name: "EmQuartier" },
  { code: "HMD-MVH", name: "Market Village HuaHin" }, { code: "HMD-KKC", name: "Central Khonkaen Campus" },
  { code: "HMD-CNV", name: "Central Northville" },
]
export const BRANCH_CODES = new Set(BRANCHES.map(b => b.code))
const MOMENTS = ["เปิดร้าน", "ระหว่างวัน", "ปิดร้าน", "รายงาน"]
const ICON_KEYS = ["checklist", "tool", "chart", "moon", "box", "receipt", "calendar", "users", "phone", "megaphone", "file", "link"]

type App = { id: number; icon: string; name: string; desc: string; url: string; audience: string; moment: string; due: string; active: boolean }
type Staff = { id: number; name: string; branches: string; active: boolean }
type LogEntry = { at: string; by: string; op: string; detail: string }
// Emails with their own menu set (menus: "*" = every menu, or app ids). Signed-in accounts
// that are not listed see the menus whose audience is "ทุกคน".
// branch: "" / missing = automatic (branch code at the start of the note, or the shop email pattern),
// a branch code = locked to it, "*" = not locked (chooses the branch — HOHW). Set on ⚙️ > สิทธิ์อีเมล.
type Login = { id: number; email: string; note: string; active: boolean; menus: "*" | number[]; branch?: string }
const DASHBOARD_URL = "/report-dashboard"


// Seed = what the site shipped with on 16 Oct 2026 (used only when the store is empty).
const SEED_APPS: Omit<App, "id">[] = [
  { icon: "checklist", name: "Morning Store Checklist", desc: "ตรวจความพร้อมก่อนเปิดร้าน ทำทุกเช้า", url: "/checklist", audience: "ทุกคน", moment: "เปิดร้าน", due: "11:00", active: true },
  { icon: "tool", name: "Service Case", desc: "บันทึกเคสที่ช่วยลูกค้า ทั้งสำเร็จและไม่สำเร็จ", url: "/case-log", audience: "ทุกคน", moment: "ระหว่างวัน", due: "", active: true },
  { icon: "chart", name: "Checklist Report Dashboard", desc: "สรุปคะแนน Checklist ทุกสาขา (เฉพาะผู้มีสิทธิ์)", url: "/report-dashboard", audience: "ผู้ดูแล", moment: "รายงาน", due: "", active: true },
]
// รายงานสาขา (/records, Antt 20 Oct 2026) — dashboard of the Service Case / ST Report records + Excel.
const RECORDS_APP: Omit<App, "id"> = { icon: "chart", name: "รายงานสาขา", desc: "สรุป Service Case · ST Report ทุกสาขา + ดาวน์โหลด Excel (เฉพาะผู้ดูแล)", url: "/records", audience: "ผู้ดูแล", moment: "รายงาน", due: "", active: true }
// ST Report (Antt, 20 Oct 2026) — added to the menu by a one-time migration (see loadAll).
const ST_REPORT_APP: Omit<App, "id"> = { icon: "file", name: "ST Report", desc: "กด + ทุกครั้งที่ขายได้ ส่งรายงานรอบ 15:00 และปิดร้าน", url: "/st-report", audience: "ทุกคน", moment: "ระหว่างวัน", due: "", active: true }
// = ALLOWED_EMAILS of the Report Dashboard script on 16 Oct 2026 (+ wetaga.chow confirmed by Antt)
const SEED_LOGINS: [string, string][] = [
  ["benyapakamonphan@gmail.com", "เจ้าของระบบ"], ["marketing.uficon@gmail.com", ""], ["th.verapat@gmail.com", "วีรภัทร (หนึ่ง) · HOHW"],
  ["jomyutdamon1211@gmail.com", "ศรายุทธ (จอมยุทธ) · HOHW"], ["qwe031168492@gmail.com", ""], ["wetaga.chow@gmail.com", "เวธกา (จ๊ะจ๋า) · HOHW"],
]
const SEED_STAFF: [string, string][] = [
  ["จารุวรรณ แสงจันทร์ฉาย (ลูกหมู)", "HES-TMN"], ["ณัฐรดา วงศ์แก้ว (นัฐ)", "HMD-HKT"], ["จักรพงค์ แซ่อิ้ว (เคน)", "HMD-HKT"],
  ["ณชกนก สมพาน (กิ๊บ)", "HMD-CCS"], ["วธันย์พัชร เกิดสวัสดิ์ (เอก)", "HES-KBI"], ["ภรภัทร ชงโค (แบม)", "HES-KBI"],
  ["อาทิตย์ แสนสอาด (ซัน)", "HMD-EMQ"], ["เบญญา ใจกว้าง (หนูนา)", "HMD-MVH"], ["ปรางทิพย์ จันทร์สิงห์ (นุ้ย)", "HMD-CCS"],
  ["เบญจา พันธุ์ทุมสาร (เบญ)", "HMD-MVH"], ["เกวลิน สายฟ้า (ซินดี้)", "HES-TMN"], ["พันธวิทย์ บุญเจริญ (บอล)", "HMD-KKC"],
  ["กรชนก ศรีรอง (มายด์)", "HMD-EMQ"], ["รัฐนันท์ อ่อนทา (แสตมป์)", "HMD-CNV"], ["จิราพร ปราโมช ณ อยุธยา (เบนซ์)", "HES-TMN"],
  ["พงศกร สารสูตร (น๊อต)", "HMD-CWN"],
  ["เวธกา เชาวน์ชูเวชช (จ๊ะจ๋า)", "*"], ["ศรายุทธ นวลจันทร์ (จอมยุทธ)", "*"], ["วีรภัทร ทองพานิชย (หนึ่ง)", "*"], ["ทรงกลด ปานรักษ์ (แฟลช)", "*"],
]

/* ---------------- storage (key/value JSON) ---------------- */
export interface Store { get(key: string): Promise<any>; set(key: string, value: any): Promise<void>; list(prefix: string): Promise<{ key: string; value: any }[]>; kind: string }

function fileStore(): Store {
  return {
    kind: "file:" + FILE_STORE,
    async get(key) { const f = Bun.file(FILE_STORE); return (await f.exists()) ? ((await f.json())[key] ?? null) : null },
    async set(key, value) {
      const f = Bun.file(FILE_STORE); const all = (await f.exists()) ? await f.json() : {}
      all[key] = value; await Bun.write(FILE_STORE, JSON.stringify(all))
    },
    async list(prefix) {
      const f = Bun.file(FILE_STORE); const all = (await f.exists()) ? await f.json() : {}
      return Object.keys(all).filter(k => k.startsWith(prefix)).sort().map(k => ({ key: k, value: all[k] }))
    },
  }
}
function pgStore(url: string): Store {
  const sql = new SQL(url, { max: Number(process.env.HUB_PG_MAX ?? 10) })   // HUB_PG_MAX=1 for single-connection test databases
  let ready: Promise<unknown> | null = null
  const init = () => (ready ??= sql`CREATE TABLE IF NOT EXISTS huawei_hub_kv (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
  // The driver may have stored JSON text as a JSON *string* (double-encoded) — unwrap until it's no longer
  // JSON text. A genuine string value (e.g. the session secret) stops the loop instead of throwing.
  const decode = (text: string) => {
    let v: any = JSON.parse(text)
    while (typeof v === "string") { try { v = JSON.parse(v) } catch { break } }
    return v
  }
  return {
    kind: "postgres",
    async get(key) {
      await init()
      const rows = await sql`SELECT value::text AS value FROM huawei_hub_kv WHERE key = ${key}`
      if (!rows.length) return null
      // The driver may bind the JSON text as a json value itself, which stores a JSON
      // *string* — decode until we get the real value (works for both forms).
      return decode(rows[0].value)
    },
    async list(prefix) {
      await init()
      const like = prefix.replace(/[\\%_]/g, m => "\\" + m) + "%"
      const rows = await sql`SELECT key, value::text AS value FROM huawei_hub_kv WHERE key LIKE ${like} ORDER BY key`
      return rows.map((r: any) => ({ key: r.key, value: decode(r.value) }))
    },
    async set(key, value) {
      await init()
      await sql`INSERT INTO huawei_hub_kv (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
    },
  }
}
export const store: Store = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore()

// One writer at a time (read-modify-write of whole collections).
let chain: Promise<unknown> = Promise.resolve()
export function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn); chain = run.catch(() => {}); return run
}

export async function loadAll(): Promise<{ apps: App[]; staff: Staff[]; logins: Login[]; log: LogEntry[] }> {
  let apps = await store.get("apps") as App[] | null
  let staff = await store.get("staff") as Staff[] | null
  const log = (await store.get("log") as LogEntry[] | null) ?? []
  if (!apps) { apps = SEED_APPS.map((a, i) => ({ id: i + 1, ...a })); await store.set("apps", apps); console.log("[hub] seeded apps", apps.length) }
  if (!staff) { staff = SEED_STAFF.map(([name, branches], i) => ({ id: i + 1, name, branches, active: true })); await store.set("staff", staff); console.log("[hub] seeded staff", staff.length) }
  let logins = await store.get("logins") as Login[] | null
  if (!logins) { logins = SEED_LOGINS.map(([email, note], i) => ({ id: i + 1, email, note, active: true, menus: "*" as const })); await store.set("logins", logins); console.log("[hub] seeded logins", logins.length) }
  // Before per-email menus existed every entry meant "all menus". Branch accounts (note = a branch
  // code) were added to sign in for staff work, so they get every menu except the Dashboard.
  if (logins.some(l => l.menus === undefined)) {
    const staffMenus = apps.filter(a => a.url !== DASHBOARD_URL).map(a => a.id)
    for (const l of logins) if (l.menus === undefined) l.menus = isOwnerEmail(l.email) || !/^(HES|HMD)-[A-Z]{3}\b/.test(l.note) ? "*" : staffMenus
    await store.set("logins", logins); console.log("[hub] migrated logins -> per-email menus")
  }
  return { apps, staff, logins, log }
}

// Once (called from initHub only, so it can't run twice at the same time): put ST Report right after
// Service Case; accounts that have Service Case get it too. The marker keeps it from coming back if the
// owner removes it on ⚙️ later.
async function migrateStReport() {
  const { apps, logins, log } = await loadAll()
  if (!(await store.get("mig_st_report"))) {
    if (!apps.some(a => a.url === ST_REPORT_APP.url)) {
      const id = Math.max(0, ...apps.map(a => a.id)) + 1
      const svc = apps.find(a => a.url === "/case-log")
      apps.splice(svc ? apps.indexOf(svc) + 1 : apps.length, 0, { id, ...ST_REPORT_APP })
      for (const l of logins) if (Array.isArray(l.menus) && svc && l.menus.includes(svc.id) && !l.menus.includes(id)) l.menus.push(id)
      log.unshift({ at: nowTH(), by: "ระบบ", op: "เพิ่มแอป", detail: ST_REPORT_APP.name })
      await store.set("apps", apps); await store.set("logins", logins); await store.set("log", log.slice(0, 300))
      console.log("[hub] added ST Report to the menu (id " + id + ")")
    }
    await store.set("mig_st_report", true)
  }
  // Once: รายงานสาขา after the Checklist Report Dashboard; accounts that may see the Dashboard get it too.
  if (!(await store.get("mig_records_app"))) {
    if (!apps.some(a => a.url === RECORDS_APP.url)) {
      const id = Math.max(0, ...apps.map(a => a.id)) + 1
      const dash = apps.find(a => a.url === DASHBOARD_URL)
      apps.splice(dash ? apps.indexOf(dash) + 1 : apps.length, 0, { id, ...RECORDS_APP })
      for (const l of logins) if (Array.isArray(l.menus) && dash && l.menus.includes(dash.id) && !l.menus.includes(id)) l.menus.push(id)
      log.unshift({ at: nowTH(), by: "ระบบ", op: "เพิ่มแอป", detail: RECORDS_APP.name })
      await store.set("apps", apps); await store.set("logins", logins); await store.set("log", log.slice(0, 300))
      console.log("[hub] added รายงานสาขา to the menu (id " + id + ")")
    }
    await store.set("mig_records_app", true)
  }
}

export async function initHub() {
  try {
    await locked(migrateStReport)
    // Read back from storage (not the seed in memory) so a broken round-trip shows up here.
    const apps = await store.get("apps"), staff = await store.get("staff")
    if (!Array.isArray(apps) || !Array.isArray(staff)) throw new Error(`read-back types: apps ${typeof apps}, staff ${typeof staff}`)
    console.log(`[hub] store ${store.kind} ok — apps ${apps.length}, staff ${staff.length} (read back)`)
  }
  catch (e) { console.error(`[hub] store ${store.kind} FAILED`, String(e)) }
}

/* ---------------- auth ---------------- */
const tokenCache = new Map<string, { email: string; until: number }>()
async function verifyGoogle(token: string): Promise<string | null> {
  if (!token) return null
  if (DEV_AUTH && token.startsWith("dev:")) return token.slice(4).toLowerCase()
  const hit = tokenCache.get(token)
  if (hit && hit.until > Date.now()) return hit.email
  try {
    const res = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token), { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const info: any = await res.json()
    const okIss = info.iss === "accounts.google.com" || info.iss === "https://accounts.google.com"
    const verified = info.email_verified === true || info.email_verified === "true"
    const exp = Number(info.exp || 0) * 1000
    if (info.aud !== CLIENT_ID || !okIss || !verified || exp < Date.now()) return null
    const email = String(info.email || "").toLowerCase().trim()
    tokenCache.set(token, { email, until: Math.min(exp, Date.now() + 5 * 60_000) })
    if (tokenCache.size > 500) for (const [k, v] of tokenCache) if (v.until < Date.now()) tokenCache.delete(k)
    return email
  } catch { return null }
}
const bearer = (req: Request) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()

/* ---------------- device session (cookie) ----------------
   Google ID tokens last 1 hour, but staff keep Service Case / ST Report open all day. After the portal
   verifies the Google token (whoami), the device gets a signed cookie (30 days) that the record APIs
   (/api/rec/*) accept. Access is re-checked on every call (an email switched off on ⚙️ stops working). */
const SESSION_COOKIE = "hub_sess", SESSION_DAYS = 30
let sessionKey: string | null = process.env.HUB_SESSION_SECRET || null
async function secret(): Promise<string> {
  if (sessionKey) return sessionKey
  let s = await store.get("session_secret")
  if (typeof s !== "string" || s.length < 32) { s = randomBytes(32).toString("hex"); await store.set("session_secret", s) }
  return (sessionKey = s)
}
const b64u = (s: string) => Buffer.from(s).toString("base64url")
async function signSession(email: string): Promise<string> {
  const body = b64u(email + "|" + (Date.now() + SESSION_DAYS * 864e5))
  return body + "." + createHmac("sha256", await secret()).update(body).digest("base64url")
}
export async function sessionEmail(req: Request): Promise<string | null> {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp("(?:^|;\\s*)" + SESSION_COOKIE + "=([^;]+)"))
  if (!m) return null
  const [body, sig] = m[1].split(".")
  if (!body || !sig) return null
  const want = createHmac("sha256", await secret()).update(body).digest()
  const got = Buffer.from(sig, "base64url")
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  const [email, exp] = Buffer.from(body, "base64url").toString().split("|")
  return Number(exp) > Date.now() && email ? email : null
}
function cookieHeader(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
}
// Branch accounts are locked to their branch (Antt, 20 Oct 2026): the branch code at the start of the note
// (e.g. "HMD-HKT"), else the shop email pattern hmdhktbyuficon@gmail.com -> HMD-HKT. The owner and the
// "ทุกเมนู" (HOHW) accounts are not locked — they choose the branch.
function lockedBranchFor(login: Login | undefined, isOwner: boolean): string | null {
  if (isOwner || !login) return null
  if (login.branch && BRANCH_CODES.has(login.branch)) return login.branch   // set on ⚙️
  if (login.branch === "*" || login.menus === "*") return null
  const n = String(login.note || "").toUpperCase().match(/^(HES|HMD)-[A-Z]{3}\b/)
  if (n && BRANCH_CODES.has(n[0])) return n[0]
  const e = canonEmail(login.email).match(/^(hes|hmd)([a-z]{3})byuficon@/)
  const code = e ? (e[1] + "-" + e[2]).toUpperCase() : ""
  return BRANCH_CODES.has(code) ? code : null
}
// What a signed-in email may do: menus = app URLs (owner = all), canDashboard, allowed = may enter,
// branch = the branch this account is locked to (null = may choose).
export async function accountAccess(email: string) {
  const d = await loadAll()
  const isOwner = isOwnerEmail(email)
  const login = d.logins.find(l => l.active && canonEmail(l.email) === canonEmail(email))
  const ids = isOwner || login?.menus === "*" ? d.apps.map(x => x.id) : login ? login.menus as number[] : null
  const menus = ids ? d.apps.filter(x => ids.includes(x.id)).map(x => x.url) : null
  return { isOwner, menus, canDashboard: !!menus && menus.includes(DASHBOARD_URL), allowed: isOwner || !!login, branch: lockedBranchFor(login, isOwner) }
}

/* ---------------- helpers ---------------- */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } })
}
const clean = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max)
export const nowTH = () => new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
function normBranches(v: unknown): string {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(",")).map(x => String(x).trim()).filter(Boolean)
  if (list.includes("*")) return "*"
  return [...new Set(list.filter(x => BRANCH_CODES.has(x)))].join(", ")
}
const publicApps = (apps: App[]) => apps.filter(a => a.active).map(({ id, active, ...a }) => a)
const publicTeam = (staff: Staff[]) => staff.filter(s => s.active).map(s => ({ name: s.name, branch: s.branches }))

function teamJs(team: { name: string; branch: string }[]): string {
  return `// HUAWEI Hub — team list (generated from the ⚙️ settings page; edit names there)
window.HUB_TEAM_MEMBERS = ${JSON.stringify(team)};
window.HUB_TEAM = window.HUB_TEAM_MEMBERS.map(function (m) { return m.name; });
// Names for one branch: that branch's staff first, then the all-branch team. No branch = everyone.
window.hubTeamFor = function (branch) {
  var M = window.HUB_TEAM_MEMBERS, has = function (m, b) { return String(m.branch).split(',').map(function (x) { return x.trim(); }).indexOf(b) !== -1; };
  if (!branch) return M.map(function (m) { return m.name; });
  return M.filter(function (m) { return m.branch !== '*' && has(m, branch); }).concat(M.filter(function (m) { return m.branch === '*'; })).map(function (m) { return m.name; });
};
`
}

/* ---------------- admin operations ---------------- */
async function applyOp(a: any, by: string): Promise<void> {
  const d = await loadAll()
  const log = (op: string, detail: string) => d.log.unshift({ at: nowTH(), by, op, detail })
  switch (a?.op) {
    case "app.save": {
      const name = clean(a.name, 80), url = clean(a.url, 300)
      if (!name) throw new Error("ใส่ชื่อแอป")
      if (!/^(\/(?!\/)|https:\/\/)/.test(url)) throw new Error("ลิงก์ต้องขึ้นต้นด้วย / หรือ https://")
      const due = /^\d{2}:\d{2}$/.test(String(a.due ?? "")) ? String(a.due) : ""
      const fields = {
        icon: ICON_KEYS.includes(a.icon) ? a.icon : "file", name, desc: clean(a.desc, 160), url,
        audience: a.audience === "ผู้ดูแล" ? "ผู้ดูแล" : "ทุกคน", moment: MOMENTS.includes(a.moment) ? a.moment : "ระหว่างวัน",
        due, active: a.active !== false,
      }
      const cur = a.row ? d.apps.find(x => x.id === Number(a.row)) : null
      if (a.row && !cur) throw new Error("ไม่พบแอปนี้ (อาจถูกแก้จากอีกเครื่อง) กดโหลดใหม่")
      if (cur) { const was = cur.active; Object.assign(cur, fields); log(was && !cur.active ? "ซ่อนแอป" : !was && cur.active ? "แสดงแอป" : "แก้ไขแอป", name) }
      else { d.apps.push({ id: Math.max(0, ...d.apps.map(x => x.id)) + 1, ...fields }); log("เพิ่มแอป", name) }
      await store.set("apps", d.apps); break
    }
    case "app.move": {
      const i = d.apps.findIndex(x => x.id === Number(a.row)), j = i + (a.dir === "up" ? -1 : 1)
      if (i < 0 || j < 0 || j >= d.apps.length) return
      ;[d.apps[i], d.apps[j]] = [d.apps[j], d.apps[i]]
      log("เรียงลำดับแอป", d.apps[j].name); await store.set("apps", d.apps); break
    }
    case "staff.save": {
      const name = clean(a.name, 100), branches = normBranches(a.branches)
      if (!name) throw new Error("ใส่ชื่อพนักงาน")
      if (!branches) throw new Error("เลือกสาขาอย่างน้อย 1 สาขา")
      const cur = a.row ? d.staff.find(x => x.id === Number(a.row)) : null
      if (a.row && !cur) throw new Error("ไม่พบพนักงานนี้ (อาจถูกแก้จากอีกเครื่อง) กดโหลดใหม่")
      if (d.staff.some(x => x !== cur && x.name === name)) throw new Error("มีชื่อนี้ในรายชื่อแล้ว")
      if (cur) {
        const was = cur.active
        Object.assign(cur, { name, branches, active: a.active !== false })
        log(was && !cur.active ? "ปิดการใช้งานพนักงาน" : !was && cur.active ? "เปิดใช้งานพนักงาน" : "แก้ไขพนักงาน", name + " · " + (branches === "*" ? "ทุกสาขา" : branches))
      } else {
        d.staff.push({ id: Math.max(0, ...d.staff.map(x => x.id)) + 1, name, branches, active: true })
        log("เพิ่มพนักงาน", name + " · " + (branches === "*" ? "ทุกสาขา" : branches))
      }
      await store.set("staff", d.staff); break
    }
    case "login.save": {
      const email = clean(a.email, 120).toLowerCase(), note = clean(a.note, 80)
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("อีเมลไม่ถูกต้อง")
      const cur = d.logins.find(x => x.email === email)
      const active = a.active !== false
      if (!active && isOwnerEmail(email)) throw new Error("ปิดสิทธิ์เจ้าของระบบไม่ได้")
      const appIds = new Set(d.apps.map(x => x.id))
      let menus: "*" | number[] = a.menus === "*" || isOwnerEmail(email) ? "*"
        : [...new Set((Array.isArray(a.menus) ? a.menus : []).map(Number).filter(x => appIds.has(x)))]
      if (a.menus === undefined && cur) menus = cur.menus           // toggling on/off keeps the menus
      if (menus !== "*" && !menus.length) throw new Error("เลือกอย่างน้อย 1 เมนู")
      // branch lock: "" auto · code · "*" free; toggling on/off (no branch sent) keeps it
      const branch = a.branch === undefined ? cur?.branch ?? "" : String(a.branch)
      if (branch && branch !== "*" && !BRANCH_CODES.has(branch)) throw new Error("สาขาไม่ถูกต้อง")
      const label = (menus === "*" ? "ทุกเมนู" : menus.map(id => d.apps.find(x => x.id === id)?.name).join(", ")) + (branch === "*" ? " · เลือกสาขาเองได้" : branch ? " · ล็อกสาขา " + branch : "")
      if (cur) {
        const was = cur.active; Object.assign(cur, { note, active, menus, branch })
        log(was && !active ? "ปิดสิทธิ์อีเมล" : !was && active ? "เปิดสิทธิ์อีเมล" : "แก้ไขอีเมล", email + " · " + label)
      } else {
        d.logins.push({ id: Math.max(0, ...d.logins.map(x => x.id)) + 1, email, note, active: true, menus, branch }); log("เพิ่มอีเมลเข้าใช้งาน", email + " · " + label)
      }
      await store.set("logins", d.logins); break
    }
    default: throw new Error("ยังไม่รองรับคำสั่งนี้")
  }
  await store.set("log", d.log.slice(0, 300))
}

async function adminData(email: string) {
  const d = await loadAll()
  return { ok: true, me: email, isOwner: true, owner: OWNERS[0], owners: OWNERS, branches: BRANCHES, apps: d.apps.map(a => ({ ...a, row: a.id })), staff: d.staff.map(s => ({ ...s, row: s.id })), logins: d.logins.map(l => ({ ...l, row: l.id, lock: lockedBranchFor(l, isOwnerEmail(l.email)) })), log: d.log }
}

/* ---------------- routes ---------------- */
// Returns a Response for /api/hub/*, /api/admin/* and /team.js, or null for anything else.
export async function hubRoute(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname
  try {
    if (p === "/team.js" && req.method === "GET") {
      const d = await loadAll()
      return new Response(teamJs(publicTeam(d.staff)), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } })
    }
    if (p === "/api/hub/apps" && req.method === "GET") return json({ ok: true, apps: publicApps((await loadAll()).apps) })
    if (p === "/api/hub/team" && req.method === "GET") return json({ ok: true, team: publicTeam((await loadAll()).staff) })
    if (p === "/api/admin/whoami" && req.method === "GET") {
      const email = await verifyGoogle(bearer(req))
      // Also used by the Report Dashboard script: it forwards the viewer's Google token and
      // asks whether that account may view (canDashboard) — one list, managed on ⚙️.
      if (!email) return json({ ok: false, email: null, isOwner: false, canDashboard: false, allowed: false })
      // menus: URLs this account may use · allowed = may enter the hub at all (owner or an active email on ⚙️ > สิทธิ์อีเมล)
      const a = await accountAccess(email)
      const res = json({ ok: true, email, ...a })
      // Allowed device: (re)issue the session cookie used by the record pages.
      if (a.allowed) res.headers.append("Set-Cookie", cookieHeader(await signSession(email), SESSION_DAYS * 86400))
      return res
    }
    if (p === "/api/hub/logout" && req.method === "POST") {
      const res = json({ ok: true }); res.headers.append("Set-Cookie", cookieHeader("", 0)); return res
    }
    if (p === "/api/admin/load" || p === "/api/admin/op") {
      const email = await verifyGoogle(bearer(req))
      if (!email) return json({ ok: false, error: "auth" }, 401)
      if (!isOwnerEmail(email)) return json({ ok: false, error: "notadmin", email }, 403)
      if (p === "/api/admin/load" && req.method === "GET") return json(await adminData(email))
      if (p === "/api/admin/op" && req.method === "POST") {
        let body: any; try { body = await req.json() } catch { return json({ ok: false, error: "bad request" }, 400) }
        try { await locked(() => applyOp(body?.admin, email)) }
        catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400) }
        console.log(`[hub] op ${body?.admin?.op} by ${email}`)
        return json(await adminData(email))
      }
      return json({ ok: false, error: "method not allowed" }, 405)
    }
  } catch (e) {
    console.error("[hub] error", p, String(e))
    if (p === "/team.js") return null // fall back to the static site/team.js
    return json({ ok: false, error: "ระบบบันทึกข้อมูลขัดข้อง ลองใหม่อีกครั้ง" }, 500)
  }
  return null
}
