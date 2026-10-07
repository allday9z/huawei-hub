/**
 * Huawei Morning Store Checklist — Web App receiver (v2, hardened by Neo 2026-10-07)
 * ---------------------------------------------------------------------------------
 * Lets the HTML checklist form write directly into the correct branch tab of
 * THIS Google Sheet ("Huawei Morning Store Check list"), so the existing 13:00
 * daily summary script keeps working exactly as before.
 *
 * WHAT CHANGED vs. v1
 *   1. Only the 9 branch tabs in ALLOWED_BRANCHES can be written — v1 wrote into
 *      whatever tab name the request sent, and the Web App is open to "Anyone".
 *   2. A script lock serializes submissions, so two people sending for the same
 *      branch at the same moment can't interleave their cells.
 *   3. The Morning Brief detail cell (column F of that row) is now always
 *      rewritten — v1 left yesterday's text there when the item failed or the
 *      detail was empty.
 *   4. Basic input checks (date, inspector, 20 answered items).
 *   Cell layout, date text and everything the 13:00 summary reads are unchanged.
 *
 * HOW TO DEPLOY (once): open the Google Sheet with the 9 branch tabs >
 * Extensions > Apps Script > paste this whole file > Deploy > New deployment >
 * "Web app" > Execute as: Me, Who has access: Anyone > Deploy, authorize >
 * copy the Web app URL (/exec) → huawei-morning-checklist.html WEBHOOK_URL.
 * Updating later: Deploy > Manage deployments > Edit (pencil) > New version.
 */

// Must match the branch tab names in this sheet (and BRANCHES in the HTML form).
var ALLOWED_BRANCHES = ["HMD-CWN", "HES-KBI", "HMD-CCS", "HMD-EMQ", "HES-TMN", "HMD-HKT", "HMD-MVH", "HMD-KKC", "HMD-CNV"];

// Row numbers for each category's items, in the same order as the HTML form's
// CATEGORIES array. These match the Morning Routine template layout.
var ROW_MAP = [
  [6, 8, 9, 10, 11, 12, 13],  // 1. ความพร้อมหน้าร้าน (Store Readiness) — 7 items
  [16, 17, 18, 19, 20],        // 2. ความพร้อมของสินค้าและอุปกรณ์หน้าร้าน (Product & Demo Readiness) — 5 items
  [23, 24, 25, 26],            // 3. ความพร้อมของสื่อการขายและโปรโมชั่น (Promotion & Sales Tool Readiness) — 4 items
  [29, 30, 31, 32]             // 4. ความพร้อมของพนักงาน (Staff Readiness) — 4 items
];

// Items whose column F holds a "pass detail" (e.g. Morning Brief topic) —
// key "categoryIndex-itemIndex", same as PASS_DETAIL_ITEMS ("c3i1") in the form.
var PASS_DETAIL_ITEMS = { "3-1": true };

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var data = JSON.parse(e.postData.contents);

    var branch = String(data.branch || '').trim();
    if (ALLOWED_BRANCHES.indexOf(branch) === -1) {
      return jsonResponse({ ok: false, error: 'สาขาไม่ถูกต้อง: ' + branch });
    }
    if (!data.date || !String(data.inspector || '').trim()) {
      return jsonResponse({ ok: false, error: 'ข้อมูลไม่ครบ (วันที่ / ผู้ตรวจสอบ)' });
    }
    if (!Array.isArray(data.categories) || data.categories.length !== ROW_MAP.length) {
      return jsonResponse({ ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' });
    }
    for (var ci = 0; ci < ROW_MAP.length; ci++) {
      var items = (data.categories[ci] || {}).items || [];
      if (items.length !== ROW_MAP[ci].length) return jsonResponse({ ok: false, error: 'จำนวนข้อไม่ครบ (หมวด ' + (ci + 1) + ')' });
      for (var k = 0; k < items.length; k++) {
        if (items[k].status !== 'pass' && items[k].status !== 'fail') return jsonResponse({ ok: false, error: 'ยังตรวจไม่ครบทุกข้อ' });
      }
    }

    lock.waitLock(20000);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(branch);
    if (!sheet) {
      return jsonResponse({ ok: false, error: 'ไม่พบแท็บสาขา: ' + branch });
    }

    // Header: date + inspector name (these cells hold the label and value together)
    sheet.getRange('D2').setValue('วันที่ ' + data.date);
    sheet.getRange('B3').setValue('ชื่อ ' + String(data.inspector).trim());

    data.categories.forEach(function (cat, ci) {
      var rows = ROW_MAP[ci];
      cat.items.forEach(function (item, ii) {
        var r = rows[ii];
        if (!r) return;

        var pass = item.status === 'pass';
        sheet.getRange('B' + r).setValue(pass);   // ผ่าน checkbox
        sheet.getRange('C' + r).setValue(!pass);  // ไม่ผ่าน checkbox
        sheet.getRange('E' + r).setValue(false);  // N/A checkbox — form no longer offers N/A

        sheet.getRange('D' + r).setValue(pass ? '' :
          'สาเหตุ: ' + (item.reason || '-') + '\nวิธีแก้ไข: ' + (item.fix || '-'));

        if (PASS_DETAIL_ITEMS[ci + '-' + ii]) {
          // Always rewrite, so the previous day's text never lingers.
          sheet.getRange('F' + r).setValue(pass ? (item.passDetail || '') : '');
        }
      });
    });

    // Note: data.generalNote ("หมายเหตุเพิ่มเติม") is still not written — tell us
    // which cell the template uses for it and it can be added here.

    SpreadsheetApp.flush();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
