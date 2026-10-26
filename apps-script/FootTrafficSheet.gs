/**
 * HUAWEI Hub — Foot Traffic → Google Sheet (v1, Neo 2026-10-26, for Antt)
 * ---------------------------------------------------------------------
 * Receives the Foot Traffic counts from HUAWEI Hub (/foot-traffic) and keeps
 * ONE ROW PER BRANCH + DAY in the tab "Foot Traffic" of THIS sheet:
 *   วันที่ | สาขา | ชื่อสาขา | ลูกค้าเข้าร้าน | ได้พูดคุย | ซื้อ (บิล) | ปิดการขาย % | ได้พูดคุย % |
 *   ช่วงเช้า … ช่วงค่ำ (ลูกค้าเข้าร้านแต่ละช่วง) | 10:00 … 21:00 (ลูกค้าเข้าร้านรายชั่วโมง) | นอกเวลา |
 *   กดล่าสุด | อัปเดตจาก Hub
 * Every send from the Hub is the whole day of that branch, so a row is simply
 * replaced (undo / delete on the page fixes the sheet too). Rows are kept
 * sorted by date (newest first), then branch.
 *
 * The tab is created on the first send (an empty "ชีต1" / "Sheet1" is renamed).
 * Do not type in the "Foot Traffic" tab — the next send overwrites its rows.
 * Make your own summaries / charts in other tabs (e.g. =QUERY('Foot Traffic'!A:Z, …)).
 *
 * DEPLOY (once):
 *   1. In this sheet: Extensions > Apps Script, delete what is there, paste this whole file, Save.
 *   2. Deploy > New deployment > type "Web app"
 *        Execute as: Me   ·   Who has access: Anyone
 *      > Deploy > allow access > copy the "Web app URL" (ends with /exec).
 *   3. Send that URL to Neo — the Hub then sends every day counted so far and keeps it up to date.
 * Changing this file later: Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy (same URL).
 */

var TAB = "Foot Traffic";
var BRANCHES = ["HES-TMN", "HMD-HKT", "HMD-CCS", "HMD-CWN", "HES-KBI", "HMD-EMQ", "HMD-MVH", "HMD-KKC", "HMD-CNV"];
var PERIODS = ["ช่วงเช้า 10–12", "ช่วงเที่ยง 12–14", "ช่วงบ่าย 14–17", "ช่วงเย็น 17–20", "ช่วงค่ำ 20–22"];
var HOURS = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21"];

function header_() {
  return ["วันที่", "สาขา", "ชื่อสาขา", "ลูกค้าเข้าร้าน (คน)", "ได้พูดคุย / สาธิต", "ซื้อสินค้า (บิล)", "ปิดการขาย %", "ได้พูดคุย %"]
    .concat(PERIODS, HOURS.map(function (h) { return h + ":00"; }), ["นอกเวลา", "กดล่าสุด", "อัปเดตจาก Hub"]);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function num_(v) { var n = Math.round(Number(v)); return isFinite(n) && n > 0 ? Math.min(n, 100000) : 0; }

function tab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB);
  if (!sh) {
    var sheets = ss.getSheets(), first = sheets[0];
    if (sheets.length === 1 && first.getLastRow() === 0 && /^(ชีต1|Sheet1)$/.test(first.getName())) { sh = first; sh.setName(TAB); }
    else sh = ss.insertSheet(TAB);
  }
  var head = header_();
  if (sh.getLastRow() === 0 || sh.getRange(1, 1).getValue() !== head[0] || sh.getLastColumn() !== head.length) {
    sh.getRange(1, 1, 1, Math.max(head.length, sh.getLastColumn() || 1)).clearContent();
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight("bold").setBackground("#C7000B").setFontColor("#FFFFFF").setWrap(true);
    sh.setFrozenRows(1);
    sh.setFrozenColumns(3);
    sh.getRange("A:A").setNumberFormat("@");
    sh.getRange("G:H").setNumberFormat("0%");
  }
  return sh;
}

function rowOf_(r, now) {
  var inN = num_(r.in), talk = num_(r.talk), buy = num_(r.buy);
  var periods = PERIODS.map(function (_, i) { return num_((r.periods || [])[i]); });
  var hours = HOURS.map(function (_, i) { return num_((r.hours || [])[i]); });
  return [String(r.date), String(r.branch), String(r.name || "").slice(0, 80), inN, talk, buy,
    inN ? buy / inN : "", inN ? talk / inN : ""]
    .concat(periods, hours, [num_(r.outside), /^\d\d:\d\d$/.test(r.lastTap) ? r.lastTap : "", now]);
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad json" }); }
  if (!body || body.source !== "huawei-hub" || !Array.isArray(body.rows)) return json_({ ok: false, error: "bad request" });
  var rows = body.rows.filter(function (r) {
    return r && /^\d{4}-\d\d-\d\d$/.test(String(r.date)) && BRANCHES.indexOf(String(r.branch)) >= 0;
  }).slice(0, 500);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = tab_(), width = header_().length;
    var now = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm");
    var last = sh.getLastRow();
    var data = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
    var at = {};
    data.forEach(function (row, i) { at[String(row[0]) + "|" + String(row[1])] = i; });
    var added = 0, updated = 0;
    rows.forEach(function (r) {
      var k = r.date + "|" + r.branch, v = rowOf_(r, now);
      if (k in at) { data[at[k]] = v; updated++; } else { at[k] = data.length; data.push(v); added++; }
    });
    data.sort(function (a, b) {
      return a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : BRANCHES.indexOf(String(a[1])) - BRANCHES.indexOf(String(b[1]));
    });
    if (data.length) sh.getRange(2, 1, data.length, width).setValues(data);
    return json_({ ok: true, added: added, updated: updated, rows: data.length });
  } finally {
    lock.releaseLock();
  }
}

// Opening the /exec URL in a browser shows this — a quick check that the deployment works.
function doGet() {
  return json_({ ok: true, app: "HUAWEI Hub Foot Traffic → Google Sheet", tab: TAB });
}
