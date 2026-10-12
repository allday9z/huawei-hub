/**
 * Huawei Morning Store Checklist — Web App receiver (v2.1, row fix by Neo 2026-10-12)
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
 *
 * v2.1 (2026-10-12) — ROW FIX. The row numbers inherited from v1 did not match
 *   the real branch tabs (checked against the actual sheet): every item from
 *   the 2nd one of each category was written ONE ROW TOO LOW, the last item of
 *   each category landed on the "รวมคะแนน" row, and row 7 / 15 / 22 / 28 were
 *   never written. ROW_MAP now follows the sheet:
 *     หมวด 1 rows 6-12 (total row 13) · หมวด 2 rows 15-19 (total 20)
 *     หมวด 3 rows 22-25 (total 26)   · หมวด 4 rows 28-31 (total 32)
 *   Morning Brief detail now goes to F29 (its own row). The stray ticks the old
 *   map left on the total rows 13/20/26/32 are cleared on every submission.
 *   B3 now holds just the inspector name (A3 already says "ผู้ตรวจสอบ").
 *   D2 date is now written like the tabs' own "วันที่ 12/10/2569" (dd/mm/พ.ศ.):
 *   the form sends ISO "2026-10-12", which the 13:00 summary's date parser read
 *   as 26/10/2012 — so every branch that used the web form showed up as
 *   "ยังไม่ส่ง" in the daily email.
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
  [6, 7, 8, 9, 10, 11, 12],    // 1. ความพร้อมหน้าร้าน (Store Readiness) — 7 items, total row 13
  [15, 16, 17, 18, 19],        // 2. ความพร้อมของสินค้าและอุปกรณ์หน้าร้าน (Product & Demo Readiness) — 5 items, total row 20
  [22, 23, 24, 25],            // 3. ความพร้อมของสื่อการขายและโปรโมชั่น (Promotion & Sales Tool Readiness) — 4 items, total row 26
  [28, 29, 30, 31]             // 4. ความพร้อมของพนักงาน (Staff Readiness) — 4 items, total row 32
];

// "รวมคะแนน" rows — v1/v2 wrote ticks here by mistake; cleared on each submission.
var TOTAL_ROWS = [13, 20, 26, 32];

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
    sheet.getRange('D2').setValue('วันที่ ' + thaiDate_(data.date));
    sheet.getRange('B3').setValue(String(data.inspector).trim());

    // Clean up what the old row map left on the "รวมคะแนน" rows (never touch formulas).
    TOTAL_ROWS.forEach(function (r) {
      ['B', 'C', 'D', 'E'].forEach(function (col) {
        var cell = sheet.getRange(col + r);
        if (!cell.getFormula()) cell.clearContent();
      });
    });

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

// "2026-10-12" -> "12/10/2569" (format the daily summary parses); anything else is kept as-is.
function thaiDate_(v) {
  var m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '/' + m[2] + '/' + (Number(m[1]) + 543) : String(v).trim();
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
