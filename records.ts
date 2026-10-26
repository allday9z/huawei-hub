// HUAWEI Hub — records for Service Case (/case-log) and ST Report (/st-report), saved per branch and day
// (Antt chose "A", 20 Oct 2026: the hub keeps them, any device of the branch sees the same list,
// nothing is lost when the device changes, admins can look back and download Excel).
//
// Storage: the hub key/value store, one key per app + branch + day:
//   rec:case:<BRANCH>:<YYYY-MM-DD> -> { cases: Case[] }
//   rec:st:<BRANCH>:<YYYY-MM-DD>   -> { entries: StEntry[], reports: StReport[] }
//   rec:check:<BRANCH>:<YYYY-MM-DD> -> { submissions: Checklist[] }   (Morning Store Checklist, Antt 22 Oct 2026:
//     the checklist only went to the Google Sheet, so /records never saw it — now it is saved here too)
// Deleted ST entries are kept with deletedAt / deletedBy (audit) and left out of reads.
// Who: the device session cookie (set by the portal after Google sign-in) + this email's menus on ⚙️.
import ExcelJS from "exceljs"
import { store, locked, json, sessionEmail, accountAccess, loadAll, ownerOf, canonEmail, isOwnerEmail, lockedBranchFor, BRANCH_CODES, BRANCHES } from "./hub"

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/
const ID = /^[\w-]{1,80}$/
const MAX_ITEMS = 200
const clean = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max)
// same, but keeps line breaks (multi-line boxes: Morning Brief, note)
const cleanLines = (v: unknown, max = 200) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }
const bkkToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const key = (app: "case" | "st" | "check", branch: string, day: string) => `rec:${app}:${branch}:${day}`

type Who = { email: string; isOwner: boolean; canDashboard: boolean; menus: string[]; branch: string | null }
// Signed-in device + this email may use the page (owner: everything).
async function who(req: Request, needUrl: string | null): Promise<Who | Response> {
  const email = await sessionEmail(req)
  if (!email) return json({ ok: false, error: "auth" }, 401)
  const a = await accountAccess(email)
  if (!a.allowed) return json({ ok: false, error: "auth" }, 401)
  const menus = a.menus ?? []
  if (needUrl === "admin" ? !(a.isOwner || a.canDashboard) : needUrl && !a.isOwner && !menus.includes(needUrl)) return json({ ok: false, error: "forbidden" }, 403)
  return { email, isOwner: a.isOwner, canDashboard: a.canDashboard, menus, branch: a.branch }
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

/* ---------------- Morning Store Checklist ---------------- */
function cleanCheck(c: any, email: string) {
  if (!BRANCH_CODES.has(c?.branch) || !DAY.test(String(c?.date))) return null
  const items: any[] = []
  for (const cat of (Array.isArray(c?.categories) ? c.categories : []).slice(0, 20))
    for (const it of (Array.isArray(cat?.items) ? cat.items : []).slice(0, 60)) {
      const status = it?.status === "pass" || it?.status === "fail" ? it.status : ""
      items.push({ cat: clean(cat?.name, 120), text: clean(it?.text, 300), status, reason: clean(it?.reason, 500), fix: clean(it?.fix, 500), passDetail: cleanLines(it?.passDetail, 3000) })
    }
  if (!items.length) return null
  const pass = items.filter(i => i.status === "pass").length, fail = items.filter(i => i.status === "fail").length
  return {
    id: ID.test(String(c?.id)) ? String(c.id) : `${c.branch}-${Date.now()}`, branch: String(c.branch), date: String(c.date),
    inspector: clean(c.inspector, 120), generalNote: cleanLines(c.generalNote, 1000), items, pass, fail, total: items.length,
    at: new Date().toISOString(), savedBy: email,
  }
}
const bkkTime = (iso: string) => { const t = new Date(iso); return isNaN(+t) ? "" : new Date(+t + 7 * 3600e3).toISOString().slice(11, 16) }

/* ---------------- Excel ---------------- */
const ST_CATS: Record<string, string> = { phone: "Phone", tablet: "Tablet", watch: "Watch", audio: "Audio", iot: "IoT", accy: "HUAWEI Accy", third: "Third-Party", pre: "Pre-order", care: "HUAWEI Care", service: "Service (Walk-in)", lost: "ปิดการขายไม่สำเร็จ" }
async function exportXlsx(url: URL): Promise<Response> {
  const from = DAY.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : bkkToday().slice(0, 8) + "01"
  const to = DAY.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : bkkToday()
  const branch = BRANCH_CODES.has(url.searchParams.get("branch") ?? "") ? url.searchParams.get("branch")! : ""
  const app = ["case", "st", "check"].includes(url.searchParams.get("app") ?? "") ? url.searchParams.get("app")! : "all"
  if (from > to) return json({ ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" }, 400)
  const inRange = (k: string) => { const p = k.split(":"); return p[3] >= from && p[3] <= to && (!branch || p[2] === branch) }
  const wb = new ExcelJS.Workbook(); wb.creator = "HUAWEI Hub"
  const head = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } } }
  const branchName = (c: string) => BRANCHES.find(b => b.code === c)?.name ?? ""
  let count = 0
  if (app === "all" || app === "case") {
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
  if (app === "all" || app === "check") {
    const ws = wb.addWorksheet("Checklist")
    ws.columns = [
      { header: "วันที่", key: "date", width: 12 }, { header: "ส่งเวลา", key: "time", width: 8 }, { header: "สาขา", key: "branch", width: 10 }, { header: "ชื่อสาขา", key: "bname", width: 26 },
      { header: "ผู้ตรวจสอบ", key: "inspector", width: 26 }, { header: "ผ่าน", key: "pass", width: 7 }, { header: "ไม่ผ่าน", key: "fail", width: 8 }, { header: "ทั้งหมด", key: "total", width: 8 },
      { header: "ข้อที่ไม่ผ่าน (สาเหตุ → แก้ไข)", key: "fails", width: 70 }, { header: "Morning Brief (บรีฟเรื่องอะไรบ้าง)", key: "brief", width: 60 }, { header: "หมายเหตุ", key: "generalNote", width: 40 }, { header: "บันทึกด้วยบัญชี", key: "savedBy", width: 28 },
    ]
    for (const { key: k, value } of await store.list("rec:check:")) {
      if (!inRange(k)) continue
      for (const c of (value?.submissions ?? []).slice().sort((a: any, b: any) => (a.at || "").localeCompare(b.at || ""))) {
        const fails = (c.items ?? []).filter((i: any) => i.status === "fail").map((i: any) => i.text + (i.reason ? ` (${i.reason}` + (i.fix ? ` → ${i.fix}` : "") + ")" : "")).join("\n")
        const brief = (c.items ?? []).filter((i: any) => i.status === "pass" && i.passDetail).map((i: any) => i.passDetail).join("\n")
        const row = ws.addRow({ ...c, bname: branchName(c.branch), time: bkkTime(c.at), fails, brief }); row.alignment = { wrapText: true, vertical: "top" }; count++
      }
    }
    head(ws)
  }
  if (app === "all" || app === "st") {
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
  const name = `huawei-hub-${app === "case" ? "service-case" : app === "st" ? "st-report" : app === "check" ? "checklist" : "records"}-${branch || "all"}-${from}_${to}.xlsx`
  console.log(`[rec] export ${app} ${branch || "all"} ${from}..${to} rows ${count}`)
  return new Response(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } })
}

/* ---------------- dashboard summary (/records) ---------------- */
function rangeOf(url: URL) {
  const from = DAY.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : bkkToday().slice(0, 8) + "01"
  const to = DAY.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : bkkToday()
  const branch = BRANCH_CODES.has(url.searchParams.get("branch") ?? "") ? url.searchParams.get("branch")! : ""
  return { from, to, branch, inRange: (k: string) => { const p = k.split(":"); return p[3] >= from && p[3] <= to && (!branch || p[2] === branch) } }
}
const bump = (m: Record<string, number>, k: string, n = 1) => { if (k) m[k] = (m[k] ?? 0) + n }
const top = (m: Record<string, number>, n = 8) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }))
async function summary(url: URL) {
  const { from, to, branch, inRange } = rangeOf(url)
  if (from > to) return json({ ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" }, 400)
  // Service Case
  const cs = { cases: 0, visits: 0, ok: 0, fail: 0, byBranch: {} as Record<string, { cases: number; ok: number; fail: number; visits: number }>, byDay: {} as Record<string, { cases: number; ok: number }>,
    products: {} as Record<string, number>, issues: {} as Record<string, number>, failReasons: {} as Record<string, number>, nextActions: {} as Record<string, number>, staff: {} as Record<string, number> }
  for (const { key: k, value } of await store.list("rec:case:")) {
    if (!inRange(k)) continue
    const [, , br, day] = k.split(":"), visits = new Set<string>()
    for (const c of value?.cases ?? []) {
      const ok = c.result === "สำเร็จ"
      cs.cases++; ok ? cs.ok++ : cs.fail++; visits.add(c.visitId || c.id)
      const b = (cs.byBranch[br] ??= { cases: 0, ok: 0, fail: 0, visits: 0 }); b.cases++; ok ? b.ok++ : b.fail++
      const d = (cs.byDay[day] ??= { cases: 0, ok: 0 }); d.cases++; if (ok) d.ok++
      bump(cs.products, c.product); for (const i of c.issues ?? []) bump(cs.issues, i)
      if (!ok) { bump(cs.failReasons, c.failReason); bump(cs.nextActions, c.nextAction) }
      bump(cs.staff, c.staff)
    }
    cs.visits += visits.size; if (cs.byBranch[br]) cs.byBranch[br].visits += visits.size
  }
  // ST Report
  const st = { totals: {} as Record<string, number>, byBranch: {} as Record<string, Record<string, number>>, byDay: {} as Record<string, number>, models: {} as Record<string, number>, sent: {} as Record<string, number>, days: {} as Record<string, number> }
  const DEVICE = new Set(["phone", "tablet", "watch", "audio", "iot"])
  for (const { key: k, value } of await store.list("rec:st:")) {
    if (!inRange(k)) continue
    const [, , br, day] = k.split(":")
    const live = (value?.entries ?? []).filter((e: any) => !e.deletedAt)
    if (live.length) st.days[br] = (st.days[br] ?? 0) + 1
    for (const e of live) {
      bump(st.totals, e.cat, e.qty); const b = (st.byBranch[br] ??= {}); bump(b, e.cat, e.qty)
      if (DEVICE.has(e.cat)) bump(st.byDay, day, e.qty)
      if (e.model) bump(st.models, `${ST_CATS[e.cat] ?? e.cat} · ${e.model}${e.size ? " (" + e.size + ")" : ""}`, e.qty)
    }
    bump(st.sent, br, new Set((value?.reports ?? []).map((r: any) => r.round)).size)
  }
  // Morning Store Checklist: which branches sent it on which days, latest + average score, items that failed most
  const ck = { sends: 0, byBranch: {} as Record<string, { days: number; sends: number; scoreSum: number; last: any }>, byDay: {} as Record<string, number>, failItems: {} as Record<string, number>, today: [] as string[] }
  const today = bkkToday()
  for (const { key: k, value } of await store.list("rec:check:")) {
    if (!inRange(k)) continue
    const [, , br, day] = k.split(":"), subs = value?.submissions ?? []
    if (!subs.length) continue
    const b = (ck.byBranch[br] ??= { days: 0, sends: 0, scoreSum: 0, last: null })
    b.days++; bump(ck.byDay, day); if (day === today) ck.today.push(br)
    const latest = subs.reduce((a: any, x: any) => (!a || (x.at || "") > (a.at || "") ? x : a), null)
    b.scoreSum += latest.total ? latest.pass / latest.total : 0   // one score per branch-day = its latest send
    if (!b.last || day > b.last.date || (day === b.last.date && latest.at > b.last.at)) b.last = { date: day, time: bkkTime(latest.at), inspector: latest.inspector, pass: latest.pass, fail: latest.fail, total: latest.total, at: latest.at }
    ck.sends += subs.length; b.sends += subs.length
    for (const i of latest.items ?? []) if (i.status === "fail") bump(ck.failItems, i.text)
  }
  const checklist = { sends: ck.sends, byDay: ck.byDay, today: ck.today, failItems: top(ck.failItems, 10),
    byBranch: Object.fromEntries(Object.entries(ck.byBranch).map(([br, b]) => [br, { days: b.days, sends: b.sends, avg: b.days ? Math.round(b.scoreSum / b.days * 100) : 0, last: b.last }])) }
  // Service (Walk-in) on the ST Report = customers on Service Case + walk-ins typed on ST
  for (const [br, b] of Object.entries(cs.byBranch)) { const x = (st.byBranch[br] ??= {}); bump(x, "service", b.visits) }
  bump(st.totals, "service", cs.visits)
  return json({
    ok: true, from, to, branch, branches: BRANCHES.map(b => b.code), cats: ST_CATS,
    case: { ...cs, products: top(cs.products), issues: top(cs.issues, 10), failReasons: top(cs.failReasons), nextActions: top(cs.nextActions), staff: top(cs.staff, 10) },
    st: { ...st, models: top(st.models, 10) }, checklist, today,
  })
}

/* ---------------- ⚙️ การใช้งาน: what each email did and when (Antt, 26 Oct 2026) ----------------
   Built from the records themselves (every save keeps the account email + time), so it also covers the
   days before this view existed — plus the first / last time each email opened the hub (act:seen:<day>).
   Times: what the device recorded (ts / at) — a save made offline is shown at the time it was made. */
const validIso = (v: unknown) => { const t = new Date(String(v ?? "")); return v && !isNaN(+t) ? t.toISOString() : "" }
async function activity(url: URL): Promise<Response> {
  const from = DAY.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : bkkToday()
  const to = DAY.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : from
  if (from > to || (Date.parse(to) - Date.parse(from)) / 864e5 > 62) return json({ ok: false, error: "ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 62 วัน)" }, 400)
  const inRange = (k: string) => { const d = k.split(":")[3]; return d >= from && d <= to }
  const { apps, logins } = await loadAll()
  const due = apps.find(a => a.url === "/checklist")?.due ?? ""
  const rows: { at: string; day: string; email: string; branch: string; app: string; action: string; detail: string; late?: string }[] = []
  const add = (r: (typeof rows)[number]) => { if (r.at && r.email) rows.push(r) }

  for (const { key: k, value } of await store.list("rec:check:")) {
    if (!inRange(k)) continue
    const [, , branch, day] = k.split(":")
    for (const c of value?.submissions ?? []) {
      const at = validIso(c.at), hm = bkkTime(at)
      add({ at, day, email: c.savedBy, branch, app: "checklist", action: "ส่ง Morning Store Checklist", detail: `ผ่าน ${c.pass}/${c.total}` + (c.inspector ? ` · ผู้ตรวจ ${c.inspector}` : ""), late: due && hm > due ? due : "" })
    }
  }
  for (const { key: k, value } of await store.list("rec:case:")) {
    if (!inRange(k)) continue
    const [, , branch, day] = k.split(":"), visits = new Map<string, any[]>()
    for (const c of value?.cases ?? []) {
      visits.set(c.visitId || c.id, [...(visits.get(c.visitId || c.id) ?? []), c])
      if (c.editedByEmail) add({ at: validIso(c.editedAt), day, email: c.editedByEmail, branch, app: "case", action: "แก้ไข Service Case", detail: [c.product, c.model, c.result].filter(Boolean).join(" · ") + (c.editedBy ? ` · โดย ${c.editedBy}` : "") })
    }
    for (const list of visits.values()) {
      const c = list[0]
      add({ at: validIso(c.ts) || validIso(c.savedAt), day, email: c.savedBy, branch, app: "case", action: "บันทึก Service Case",
        detail: `${list.length} เคส · ` + list.map((x: any) => [x.product, x.model, x.result].filter(Boolean).join(" ")).join(" / ") + (c.staff ? ` · ผู้บันทึก ${c.staff}` : "") })
    }
  }
  for (const { key: k, value } of await store.list("rec:st:")) {
    if (!inRange(k)) continue
    const [, , branch, day] = k.split(":")
    for (const e of value?.entries ?? []) {
      const what = [ST_CATS[e.cat] ?? e.cat, e.model, e.color, e.size].filter(Boolean).join(" ") + ` × ${e.qty}`
      add({ at: validIso(e.ts) || validIso(e.savedAt), day, email: e.savedBy, branch, app: "st", action: "บันทึกยอดขาย (ST Report)", detail: what + (e.staff ? ` · ผู้บันทึก ${e.staff}` : "") })
      if (e.deletedAt) add({ at: validIso(e.deletedAt), day, email: e.deletedBy, branch, app: "st", action: "ลบรายการ ST Report", detail: what })
    }
    for (const r of value?.reports ?? [])
      add({ at: validIso(r.at), day, email: r.savedBy, branch, app: "st", action: `ส่ง ST Report รอบ ${r.round}` + (r.round === 1 ? " (10:00–15:00)" : " (ทั้งวัน)"), detail: r.staff ? `ผู้ส่ง ${r.staff}` : "" })
  }
  // opened the hub: one row per email per day (first – last time)
  const lockOf = (email: string) => lockedBranchFor(logins.find(l => canonEmail(l.email) === canonEmail(email)), isOwnerEmail(email)) ?? ""
  for (const { key: k, value } of await store.list("act:seen:")) {
    const day = k.split(":")[2]
    if (!(day >= from && day <= to)) continue
    for (const x of Object.values<any>(value ?? {}))
      add({ at: validIso(x.first), day, email: x.email, branch: lockOf(x.email), app: "seen", action: "เข้าใช้งาน HUAWEI Hub",
        detail: `ครั้งแรก ${bkkTime(x.first)} · ล่าสุด ${bkkTime(x.last)} · ${x.n} ครั้ง` })
  }
  rows.sort((a, b) => b.at.localeCompare(a.at))
  const notes = Object.fromEntries(logins.map(l => [canonEmail(l.email), l.note || ""]))
  const people = [...new Set(rows.map(r => r.email))].map(email => ({ email, note: notes[canonEmail(email)] ?? "", branch: lockOf(email) }))
  return json({ ok: true, from, to, due, total: rows.length, rows: rows.slice(0, 20000), people })
}

/* ---------------- routes ---------------- */
export async function recordsRoute(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname
  if (p === "/api/admin/activity" && req.method === "GET") {
    try {
      const owner = await ownerOf(req); if (owner instanceof Response) return owner
      return await activity(url)
    } catch (e) {
      console.error("[rec] activity error", String(e))
      return json({ ok: false, error: "โหลดประวัติไม่สำเร็จ ลองใหม่อีกครั้ง" }, 500)
    }
  }
  if (!p.startsWith("/api/rec/")) return null
  try {
    if (p === "/api/rec/summary" && req.method === "GET") {
      const w = await who(req, "admin"); if (w instanceof Response) return w
      return await summary(url)
    }
    if (p === "/api/rec/export.xlsx" && req.method === "GET") {
      const w = await who(req, "admin"); if (w instanceof Response) return w
      return await exportXlsx(url)
    }
    if (p === "/api/rec/check") {
      const w = await who(req, "/checklist"); if (w instanceof Response) return w
      if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405)
      let b: any; try { b = await req.json() } catch { return json({ ok: false, error: "bad request" }, 400) }
      if (w.branch && b?.branch !== w.branch) return json({ ok: false, error: "branch", branch: w.branch }, 403)   // locked to its own branch
      const c = cleanCheck(b, w.email); if (!c) return json({ ok: false, error: "ข้อมูลไม่ครบ (สาขา / วันที่ / รายการ)" }, 400)
      let dup = false
      await locked(async () => {
        const k = key("check", c.branch, c.date), d = (await store.get(k)) ?? { submissions: [] }
        d.submissions ??= []; dup = d.submissions.some((x: any) => x.id === c.id)
        if (!dup) { d.submissions.push(c); await store.set(k, d) }
      })
      console.log(`[rec] check ${c.branch} ${c.date} ${c.pass}/${c.total}${dup ? " (already saved)" : ""} by ${w.email}`)
      return json({ ok: true, id: c.id, pass: c.pass, total: c.total })
    }
    const app = p === "/api/rec/case" ? "case" : p === "/api/rec/st" ? "st" : null
    if (!app) return json({ ok: false, error: "not found" }, 404)
    const w = await who(req, app === "case" ? "/case-log" : "/st-report"); if (w instanceof Response) return w

    if (req.method === "GET") {
      const branch = url.searchParams.get("branch") ?? "", day = url.searchParams.get("date") ?? ""
      if (!BRANCH_CODES.has(branch) || !DAY.test(day)) return json({ ok: false, error: "bad request" }, 400)
      if (w.branch && branch !== w.branch) return json({ ok: false, error: "branch", branch: w.branch }, 403)   // locked to its own branch
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
    // An account locked to a branch can only write that branch (anything else is dropped, not retried).
    const mine = (x: any) => !w.branch || x?.branch === w.branch

    if (app === "case") {
      const raw = (Array.isArray(b?.cases) ? b.cases : []).slice(0, MAX_ITEMS)
      const incoming = raw.filter(mine).map((c: any) => cleanCase(c, w.email)).filter(Boolean)
      const allUpdates = (Array.isArray(b?.updates) ? b.updates : []).slice(0, MAX_ITEMS)
      const updates = allUpdates.filter(mine)
      const rejected = [...raw, ...allUpdates].filter((x: any) => !mine(x)).map((x: any) => String(x?.id ?? ""))
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
      console.log(`[rec] case +${accepted.length} ~${updated.length}${rejected.length ? ` (other branch dropped ${rejected.length})` : ""} by ${w.email}`)
      return json({ ok: true, accepted: [...accepted, ...rejected], updated: [...updated, ...rejected] })
    }

    // ST Report
    const st = b?.st ?? {}
    const rawEntries = (Array.isArray(st.entries) ? st.entries : []).slice(0, MAX_ITEMS)
    const dropped = rawEntries.filter((e: any) => !mine(e)).map((e: any) => String(e?.id ?? ""))
    const entries = rawEntries.filter(mine).map((e: any) => cleanEntry(e, w.email)).filter(Boolean)
    const deletes = (Array.isArray(st.deletes) ? st.deletes : []).slice(0, MAX_ITEMS).map(String).filter((x: string) => ID.test(x))
    const rawReports = (Array.isArray(st.reports) ? st.reports : []).slice(0, 50)
    const reports = rawReports.filter(mine).map((r: any) => cleanReport(r, w.email)).filter(Boolean)
    const ctxBranch = BRANCH_CODES.has(b?.branch) && mine(b) ? b.branch : w.branch ?? "", ctxDay = DAY.test(String(b?.date)) ? b.date : bkkToday()
    const res = { accepted: [...dropped], deleted: [] as string[], reports: rawReports.filter((r: any) => !mine(r)).map((r: any) => String(r?.key ?? "")) }
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
