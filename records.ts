// HUAWEI Hub — records for Service Case (/case-log) and ST Report (/st-report), saved per branch and day
// (Antt chose "A", 20 Oct 2026: the hub keeps them, any device of the branch sees the same list,
// nothing is lost when the device changes, admins can look back and download Excel).
//
// Storage: the hub key/value store, one key per app + branch + day:
//   rec:case:<BRANCH>:<YYYY-MM-DD> -> { cases: Case[] }
//   rec:st:<BRANCH>:<YYYY-MM-DD>   -> { entries: StEntry[], reports: StReport[] }
// Deleted ST entries are kept with deletedAt / deletedBy (audit) and left out of reads.
// Who: the device session cookie (set by the portal after Google sign-in) + this email's menus on ⚙️.
import ExcelJS from "exceljs"
import { store, locked, json, sessionEmail, accountAccess, BRANCH_CODES, BRANCHES } from "./hub"

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/
const ID = /^[\w-]{1,80}$/
const MAX_ITEMS = 200
const clean = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max)
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }
const bkkToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const key = (app: "case" | "st", branch: string, day: string) => `rec:${app}:${branch}:${day}`

type Who = { email: string; isOwner: boolean; canDashboard: boolean; menus: string[] }
// Signed-in device + this email may use the page (owner: everything).
async function who(req: Request, needUrl: string | null): Promise<Who | Response> {
  const email = await sessionEmail(req)
  if (!email) return json({ ok: false, error: "auth" }, 401)
  const a = await accountAccess(email)
  if (!a.allowed) return json({ ok: false, error: "auth" }, 401)
  const menus = a.menus ?? []
  if (needUrl === "admin" ? !(a.isOwner || a.canDashboard) : needUrl && !a.isOwner && !menus.includes(needUrl)) return json({ ok: false, error: "forbidden" }, 403)
  return { email, isOwner: a.isOwner, canDashboard: a.canDashboard, menus }
}

/* ---------------- Service Case ---------------- */
const CASE_FIELDS = ["product", "model", "result", "failReason", "nextAction", "note"] as const
function caseFields(f: any) {
  const out: any = {}
  for (const k of CASE_FIELDS) out[k] = clean(f?.[k], k === "note" ? 600 : 200)
  out.issues = (Array.isArray(f?.issues) ? f.issues : []).slice(0, 15).map((x: unknown) => clean(x, 200)).filter(Boolean)
  return out
}
function cleanCase(c: any, email: string) {
  if (!ID.test(String(c?.id)) || !BRANCH_CODES.has(c?.branch) || !DAY.test(String(c?.date))) return null
  return {
    id: String(c.id), visitId: clean(c.visitId, 80), caseNo: int(c.caseNo, 1, 50, 1), caseCount: int(c.caseCount, 1, 50, 1),
    ts: clean(c.ts, 40), date: String(c.date), time: TIME.test(String(c.time)) ? String(c.time) : "", branch: String(c.branch),
    staff: clean(c.staff, 120), ...caseFields(c), savedBy: email, savedAt: new Date().toISOString(),
  }
}
async function caseDay(branch: string, day: string): Promise<{ cases: any[] }> {
  return (await store.get(key("case", branch, day))) ?? { cases: [] }
}

/* ---------------- ST Report ---------------- */
function cleanEntry(e: any, email: string) {
  if (!ID.test(String(e?.id)) || !BRANCH_CODES.has(e?.branch) || !DAY.test(String(e?.date))) return null
  return {
    id: String(e.id), ts: clean(e.ts, 40), date: String(e.date), time: TIME.test(String(e.time)) ? String(e.time) : "",
    branch: String(e.branch), cat: clean(e.cat, 20), model: clean(e.model, 100), color: clean(e.color, 60), size: clean(e.size, 60),
    qty: int(e.qty, 1, 999, 1), staff: clean(e.staff, 120), savedBy: email, savedAt: new Date().toISOString(),
  }
}
function cleanReport(r: any, email: string) {
  if (!BRANCH_CODES.has(r?.branch) || !DAY.test(String(r?.date)) || ![1, 2].includes(Number(r?.round))) return null
  const totals: Record<string, number | string> = {}
  for (const [k, v] of Object.entries(r?.totals ?? {}).slice(0, 40)) totals[clean(k, 30)] = typeof v === "number" ? v : clean(v, 1000)
  return { key: clean(r.key, 80), branch: String(r.branch), date: String(r.date), round: Number(r.round), at: clean(r.at, 40), staff: clean(r.staff, 120), totals, text: clean(r.text, 6000).replace(/ {2,}/g, " "), savedBy: email }
}
async function stDay(branch: string, day: string): Promise<{ entries: any[]; reports: any[] }> {
  const d = (await store.get(key("st", branch, day))) ?? {}
  return { entries: d.entries ?? [], reports: d.reports ?? [] }
}
// "15:05" per round — the latest send of each round that day
function stSent(reports: any[]) {
  const out: Record<number, string> = {}
  for (const r of reports) {
    const t = new Date(r.at); if (isNaN(+t)) continue
    const hm = new Date(+t + 7 * 3600e3).toISOString().slice(11, 16)
    if (!out[r.round] || hm > out[r.round]) out[r.round] = hm
  }
  return out
}

/* ---------------- Excel ---------------- */
const ST_CATS: Record<string, string> = { phone: "Phone", tablet: "Tablet", watch: "Watch", audio: "Audio", iot: "IoT", accy: "HUAWEI Accy", third: "Third-Party", pre: "Pre-order", care: "HUAWEI Care", service: "Service (Walk-in)", lost: "ปิดการขายไม่สำเร็จ" }
async function exportXlsx(url: URL): Promise<Response> {
  const from = DAY.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : bkkToday().slice(0, 8) + "01"
  const to = DAY.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : bkkToday()
  const branch = BRANCH_CODES.has(url.searchParams.get("branch") ?? "") ? url.searchParams.get("branch")! : ""
  const app = ["case", "st"].includes(url.searchParams.get("app") ?? "") ? url.searchParams.get("app")! : "all"
  if (from > to) return json({ ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" }, 400)
  const inRange = (k: string) => { const p = k.split(":"); return p[3] >= from && p[3] <= to && (!branch || p[2] === branch) }
  const wb = new ExcelJS.Workbook(); wb.creator = "HUAWEI Hub"
  const head = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } } }
  const branchName = (c: string) => BRANCHES.find(b => b.code === c)?.name ?? ""
  let count = 0
  if (app !== "st") {
    const ws = wb.addWorksheet("Service Case")
    ws.columns = [
      { header: "วันที่", key: "date", width: 12 }, { header: "เวลา", key: "time", width: 8 }, { header: "สาขา", key: "branch", width: 10 }, { header: "ชื่อสาขา", key: "bname", width: 26 },
      { header: "ผู้บันทึก", key: "staff", width: 26 }, { header: "ลูกค้า (รหัสการมา)", key: "visit", width: 30 }, { header: "เคสที่", key: "no", width: 8 },
      { header: "ประเภทสินค้า", key: "product", width: 13 }, { header: "รุ่น", key: "model", width: 22 }, { header: "เรื่องที่ช่วยลูกค้า", key: "issues", width: 40 },
      { header: "ผลลัพธ์", key: "result", width: 10 }, { header: "สาเหตุที่ไม่สำเร็จ", key: "failReason", width: 28 }, { header: "ขั้นตอนต่อไป", key: "nextAction", width: 28 },
      { header: "หมายเหตุ", key: "note", width: 30 }, { header: "แก้ไขโดย", key: "editedBy", width: 22 }, { header: "บันทึกด้วยบัญชี", key: "savedBy", width: 28 },
    ]
    for (const { key: k, value } of await store.list("rec:case:")) {
      if (!inRange(k)) continue
      for (const c of (value?.cases ?? []).slice().sort((a: any, b: any) => (a.time || "").localeCompare(b.time || "") || a.caseNo - b.caseNo)) {
        ws.addRow({ ...c, bname: branchName(c.branch), visit: c.visitId, no: c.caseCount > 1 ? `${c.caseNo}/${c.caseCount}` : 1, issues: (c.issues ?? []).join(", ") }); count++
      }
    }
    head(ws)
  }
  if (app !== "case") {
    const ws = wb.addWorksheet("ST Report รายการ")
    ws.columns = [
      { header: "วันที่", key: "date", width: 12 }, { header: "เวลา", key: "time", width: 8 }, { header: "รอบ", key: "round", width: 6 }, { header: "สาขา", key: "branch", width: 10 },
      { header: "ผู้บันทึก", key: "staff", width: 26 }, { header: "หมวด", key: "cat", width: 18 }, { header: "รุ่น", key: "model", width: 26 }, { header: "ขนาด", key: "size", width: 10 },
      { header: "สี", key: "color", width: 14 }, { header: "จำนวน", key: "qty", width: 8 }, { header: "บันทึกด้วยบัญชี", key: "savedBy", width: 28 },
    ]
    const ws2 = wb.addWorksheet("ST Report สรุปรอบ")
    const sumCats = Object.keys(ST_CATS)
    ws2.columns = [
      { header: "วันที่", key: "date", width: 12 }, { header: "สาขา", key: "branch", width: 10 }, { header: "รอบ", key: "round", width: 6 }, { header: "ส่งเวลา", key: "sent", width: 9 },
      { header: "ผู้บันทึก", key: "staff", width: 26 }, ...sumCats.map(k => ({ header: ST_CATS[k], key: k, width: 12 })), { header: "ข้อความที่ส่ง", key: "text", width: 60 },
    ]
    for (const { key: k, value } of await store.list("rec:st:")) {
      if (!inRange(k)) continue
      for (const e of (value?.entries ?? []).filter((e: any) => !e.deletedAt).sort((a: any, b: any) => (a.time || "").localeCompare(b.time || ""))) {
        ws.addRow({ ...e, round: e.time && e.time <= "15:00" ? 1 : 2, cat: ST_CATS[e.cat] ?? e.cat }); count++
      }
      for (const r of value?.reports ?? []) {
        ws2.addRow({ ...r, ...Object.fromEntries(sumCats.map(c => [c, r.totals?.[c] ?? ""])), sent: stSent([r])[r.round] ?? "" })
      }
    }
    head(ws); head(ws2)
  }
  const buf = await wb.xlsx.writeBuffer()
  const name = `huawei-hub-${app === "case" ? "service-case" : app === "st" ? "st-report" : "records"}-${branch || "all"}-${from}_${to}.xlsx`
  console.log(`[rec] export ${app} ${branch || "all"} ${from}..${to} rows ${count}`)
  return new Response(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } })
}

/* ---------------- routes ---------------- */
export async function recordsRoute(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname
  if (!p.startsWith("/api/rec/")) return null
  try {
    if (p === "/api/rec/export.xlsx" && req.method === "GET") {
      const w = await who(req, "admin"); if (w instanceof Response) return w
      return await exportXlsx(url)
    }
    const app = p === "/api/rec/case" ? "case" : p === "/api/rec/st" ? "st" : null
    if (!app) return json({ ok: false, error: "not found" }, 404)
    const w = await who(req, app === "case" ? "/case-log" : "/st-report"); if (w instanceof Response) return w

    if (req.method === "GET") {
      const branch = url.searchParams.get("branch") ?? "", day = url.searchParams.get("date") ?? ""
      if (!BRANCH_CODES.has(branch) || !DAY.test(day)) return json({ ok: false, error: "bad request" }, 400)
      const cases = (await caseDay(branch, day)).cases
      if (app === "case") return json({ ok: true, cases: cases.slice().sort((a, b) => (b.ts || "").localeCompare(a.ts || "") || a.caseNo - b.caseNo) })
      const st = await stDay(branch, day)
      // Service (Walk-in) on the ST Report counts customers served on the Service Case page (one per visit).
      const visits = new Map<string, string>()
      for (const c of cases) if (!visits.has(c.visitId || c.id)) visits.set(c.visitId || c.id, c.time)
      return json({ ok: true, st: st.entries.filter(e => !e.deletedAt), stSent: stSent(st.reports), cases: [...visits.values()].map(time => ({ time })) })
    }
    if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405)
    let b: any; try { b = await req.json() } catch { return json({ ok: false, error: "bad request" }, 400) }

    if (app === "case") {
      const incoming = (Array.isArray(b?.cases) ? b.cases : []).slice(0, MAX_ITEMS).map((c: any) => cleanCase(c, w.email)).filter(Boolean)
      const updates = (Array.isArray(b?.updates) ? b.updates : []).slice(0, MAX_ITEMS)
      const accepted: string[] = [], updated: string[] = []
      await locked(async () => {
        const byKey = new Map<string, any[]>()
        for (const c of incoming) { const k = key("case", c.branch, c.date); byKey.set(k, [...(byKey.get(k) ?? []), c]) }
        for (const [k, list] of byKey) {
          const d = (await store.get(k)) ?? { cases: [] }
          for (const c of list) { if (!d.cases.some((x: any) => x.id === c.id)) d.cases.push(c); accepted.push(c.id) }   // re-sent = already saved
          await store.set(k, d)
        }
        for (const u of updates) {
          if (!ID.test(String(u?.id)) || !BRANCH_CODES.has(u?.branch)) continue
          // the day is given by the page; older pages may not send it — then look through that branch
          const keys = DAY.test(String(u.date)) ? [key("case", u.branch, u.date)] : (await store.list(`rec:case:${u.branch}:`)).map(x => x.key).reverse()
          for (const k of keys) {
            const d = await store.get(k); const c = d?.cases?.find((x: any) => x.id === u.id)
            if (!c) continue
            Object.assign(c, caseFields(u.fields), { editedBy: clean(u.editedBy, 120), editedAt: clean(u.editedAt, 40), editedByEmail: w.email })
            await store.set(k, d); updated.push(u.id); break
          }
          if (!updated.includes(u.id)) updated.push(u.id)   // gone / unknown: nothing to retry
        }
      })
      console.log(`[rec] case +${accepted.length} ~${updated.length} by ${w.email}`)
      return json({ ok: true, accepted, updated })
    }

    // ST Report
    const st = b?.st ?? {}
    const entries = (Array.isArray(st.entries) ? st.entries : []).slice(0, MAX_ITEMS).map((e: any) => cleanEntry(e, w.email)).filter(Boolean)
    const deletes = (Array.isArray(st.deletes) ? st.deletes : []).slice(0, MAX_ITEMS).map(String).filter((x: string) => ID.test(x))
    const reports = (Array.isArray(st.reports) ? st.reports : []).slice(0, 50).map((r: any) => cleanReport(r, w.email)).filter(Boolean)
    const ctxBranch = BRANCH_CODES.has(b?.branch) ? b.branch : "", ctxDay = DAY.test(String(b?.date)) ? b.date : bkkToday()
    const res = { accepted: [] as string[], deleted: [] as string[], reports: [] as string[] }
    await locked(async () => {
      const keys = new Set<string>([...entries.map((e: any) => key("st", e.branch, e.date)), ...reports.map((r: any) => key("st", r.branch, r.date))])
      if (ctxBranch) keys.add(key("st", ctxBranch, ctxDay))
      for (const k of keys) {
        const d = (await store.get(k)) ?? { entries: [], reports: [] }
        d.entries ??= []; d.reports ??= []
        for (const e of entries) if (key("st", e.branch, e.date) === k) { if (!d.entries.some((x: any) => x.id === e.id)) d.entries.push(e); res.accepted.push(e.id) }
        for (const r of reports) if (key("st", r.branch, r.date) === k) { d.reports.push(r); res.reports.push(r.key) }
        for (const id of deletes) {
          const e = d.entries.find((x: any) => x.id === id)
          if (e && !e.deletedAt) { e.deletedAt = new Date().toISOString(); e.deletedBy = w.email }
          if (e && !res.deleted.includes(id)) res.deleted.push(id)
        }
        await store.set(k, d)
      }
      for (const id of deletes) if (!res.deleted.includes(id) && !entries.some((e: any) => e.id === id)) res.deleted.push(id)   // never saved: nothing to delete
    })
    console.log(`[rec] st +${res.accepted.length} -${res.deleted.length} reports ${res.reports.length} by ${w.email}`)
    return json({ ok: true, st: res })
  } catch (e) {
    console.error("[rec] error", p, String(e))
    return json({ ok: false, error: "ระบบบันทึกข้อมูลขัดข้อง ลองใหม่อีกครั้ง" }, 500)
  }
}
