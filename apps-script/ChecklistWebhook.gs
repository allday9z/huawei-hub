/**
 * Huawei Morning Store Checklist — Web App receiver (v3, Neo 2026-10-12)
 * ---------------------------------------------------------------------
 * Lets the HTML checklist form write directly into the correct branch tab of
 * THIS Google Sheet ("Huawei Morning Store Check list"), so the existing 13:00
 * daily summary keeps working.
 *
 * WHAT'S NEW IN v3
 *   The branch tabs are NOT laid out identically (HKT/MVH/KKC have a blank row
 *   7, KBI has a blank row in category 4, the others have none), so fixed row
 *   numbers can never be right for every tab. v3 finds the rows in each tab the
 *   same way the 13:00 summary reads them:
 *     category header row (e.g. "ความพร้อมหน้าร้าน (Store Readiness)")
 *       → its item rows (non-blank label in column A)
 *       → up to its "รวมคะแนน …" row
 *   Each answer goes to the row whose label matches the item text; an existing
 *   item whose wording differs slightly falls back to its position in the
 *   category. If a tab has no row for an item (e.g. new items not added yet)
 *   NOTHING is written and the form shows which tab/item is missing.
 *
 *   addNewChecklistItems() — run ONCE from the Apps Script editor to add the 4
 *   new items (Oct 2026) to all 9 branch tabs: inserts a row per item at the end
 *   of its category (format + checkboxes copied from the row above), updates
 *   "รวมคะแนน คะแนนเต็ม N", the grand total formulas/label, the F3 text and the
 *   H2 grade formula for the new full score. Safe to run twice (items already
 *   present are skipped). previewNewChecklistItems() shows what it would do
 *   (Execution log) without changing anything.
 *
 * Kept from v2: only the 9 branch tabs can be written, a script lock serializes
 * submissions, basic input checks, D2 date written as "วันที่ dd/mm/พ.ศ." (the
 * format the 13:00 summary parses), B3 = inspector name.
 *
 * DEPLOY: Extensions > Apps Script > paste this whole file > Deploy >
 * Manage deployments > Edit (pencil) > New version > Deploy (same /exec URL).
 */

// Must match the branch tab names in this sheet (and BRANCHES in the HTML form).
var ALLOWED_BRANCHES = ["HMD-CWN", "HES-KBI", "HMD-CCS", "HMD-EMQ", "HES-TMN", "HMD-HKT", "HMD-MVH", "HMD-KKC", "HMD-CNV"];

// Category headers in column A, in form order (matched by these key phrases).
var CATEGORY_KEYS = ["Store Readiness", "Product & Demo Readiness", "Promotion & Sales Tool Readiness", "Staff Readiness"];

// The 4 items added in Oct 2026 — same wording as the HTML form.
var NEW_ITEMS = [
  { cat: 0, text: "ตรวจเช็คกล้องวงจรปิดที่แคชเชียร์และในร้านทำงานครบทุกตัว" },
  { cat: 0, text: "ไม่มีลังกระดาษวางทิ้งไว้" },
  { cat: 1, text: "Security ทำงานปกติ มีไฟเลี้ยงทุกเครื่อง และไม่มีรอยคราบกาวบนสาย" },
  { cat: 2, text: "ป้ายสื่อโฆษณาสินค้าภายในร้าน (Digital/A1/X-Stand) อัปเดตเป็นปัจจุบัน และกำจัดป้ายหมดอายุทิ้งออกนอกบริเวณร้าน" }
];

// Grade thresholds for H2, scaled from the original 20 / 18 / 15 / 12.
function gradeThresholds_(full) {
  return { great: full, veryGood: Math.round(full * 0.9), good: Math.round(full * 0.75), improve: Math.round(full * 0.6) };
}

/* ======================= Web App: receive a checklist ======================= */

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
    if (!Array.isArray(data.categories) || data.categories.length !== CATEGORY_KEYS.length) {
      return jsonResponse({ ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' });
    }
    for (var ci = 0; ci < data.categories.length; ci++) {
      var items = (data.categories[ci] || {}).items || [];
      if (!items.length) return jsonResponse({ ok: false, error: 'ข้อมูลหมวด ' + (ci + 1) + ' ว่าง' });
      for (var k = 0; k < items.length; k++) {
        if (items[k].status !== 'pass' && items[k].status !== 'fail') return jsonResponse({ ok: false, error: 'ยังตรวจไม่ครบทุกข้อ' });
      }
    }

    lock.waitLock(20000);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(branch);
    if (!sheet) return jsonResponse({ ok: false, error: 'ไม่พบแท็บสาขา: ' + branch });

    // Work out every target row BEFORE writing anything.
    var layout = readLayout_(sheet);
    if (layout.error) return jsonResponse({ ok: false, error: 'แท็บ ' + branch + ': ' + layout.error });
    var plan = [];
    for (ci = 0; ci < data.categories.length; ci++) {
      var res = assignRows_(layout.blocks[ci], data.categories[ci].items);
      if (res.missing.length) {
        return jsonResponse({ ok: false, error: 'แท็บ ' + branch + ' ยังไม่มีแถวสำหรับ: ' + res.missing.join(', ') + ' — แจ้งผู้ดูแลให้รัน addNewChecklistItems()' });
      }
      plan = plan.concat(res.plan);
    }

    sheet.getRange('D2').setValue('วันที่ ' + thaiDate_(data.date));
    sheet.getRange('B3').setValue(String(data.inspector).trim());

    plan.forEach(function (p) {
      var item = p.item, r = p.row, pass = item.status === 'pass';
      sheet.getRange('B' + r).setValue(pass);   // ผ่าน checkbox
      sheet.getRange('C' + r).setValue(!pass);  // ไม่ผ่าน checkbox
      sheet.getRange('E' + r).setValue(false);  // N/A checkbox — form doesn't offer N/A
      sheet.getRange('D' + r).setValue(pass ? '' : 'สาเหตุ: ' + (item.reason || '-') + '\nวิธีแก้ไข: ' + (item.fix || '-'));
      if (/Morning\s*Brief/i.test(String(item.text || ''))) {
        // Always rewrite, so the previous day's text never lingers.
        sheet.getRange('F' + r).setValue(pass ? (item.passDetail || '') : '');
      }
    });

    SpreadsheetApp.flush();
    return jsonResponse({ ok: true, rows: plan.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ======================= Layout detection (shared) ======================= */

function norm_(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
function isNewItem_(label) { return NEW_ITEMS.some(function (n) { return norm_(n.text) === norm_(label); }); }

// → { blocks: [{ header, items:[{row,label}], totalRow }], grandTotalRow, firstItemRow, lastItemRow } or { error }
function readLayout_(sheet) {
  var last = Math.min(sheet.getLastRow(), 120);
  var labels = sheet.getRange(1, 1, last, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); });
  var blocks = [], grandTotalRow = -1, i;
  for (var c = 0; c < CATEGORY_KEYS.length; c++) {
    var key = norm_(CATEGORY_KEYS[c]), header = -1;
    for (i = 0; i < labels.length; i++) if (norm_(labels[i]).indexOf(key) !== -1) { header = i + 1; break; }
    if (header < 0) return { error: 'ไม่พบหัวข้อหมวด "' + CATEGORY_KEYS[c] + '"' };
    var items = [], totalRow = -1;
    for (i = header; i < labels.length; i++) {           // labels[i] is row i+1
      var lab = labels[i];
      if (/^รวมคะแนน/.test(lab)) { totalRow = i + 1; break; }
      if (lab) items.push({ row: i + 1, label: lab });
    }
    if (totalRow < 0) return { error: 'ไม่พบแถว "รวมคะแนน" ของหมวด ' + (c + 1) };
    blocks.push({ header: header, items: items, totalRow: totalRow });
  }
  for (i = blocks[blocks.length - 1].totalRow; i < labels.length; i++) {
    if (/^รวมคะแนนทั้งหมด/.test(labels[i])) { grandTotalRow = i + 1; break; }
  }
  var firstItemRow = blocks[0].items.length ? blocks[0].items[0].row : blocks[0].header + 1;
  var lb = blocks[blocks.length - 1];
  var lastItemRow = lb.items.length ? lb.items[lb.items.length - 1].row : lb.totalRow - 1;
  return { blocks: blocks, grandTotalRow: grandTotalRow, firstItemRow: firstItemRow, lastItemRow: lastItemRow };
}

// Exact text match first; existing items whose wording differs fill the
// remaining (non-new) rows of the category in order.
function assignRows_(block, items) {
  var claimed = {}, rowFor = [];
  items.forEach(function (it, i) {
    var t = norm_(it.text);
    for (var k = 0; k < block.items.length; k++) {
      if (!claimed[k] && t && norm_(block.items[k].label) === t) { claimed[k] = true; rowFor[i] = block.items[k].row; return; }
    }
  });
  var missing = [];
  items.forEach(function (it, i) {
    if (rowFor[i]) return;
    // A brand-new item must have its own row (run addNewChecklistItems first).
    if (!isNewItem_(it.text)) {
      for (var k = 0; k < block.items.length; k++) {
        if (!claimed[k] && !isNewItem_(block.items[k].label)) { claimed[k] = true; rowFor[i] = block.items[k].row; return; }
      }
    }
    missing.push('"' + String(it.text || ('ข้อ ' + (i + 1))).slice(0, 40) + '"');
  });
  return { plan: items.map(function (it, i) { return { item: it, row: rowFor[i] }; }), missing: missing };
}

/* ======================= One-time: add the new items ======================= */

function previewNewChecklistItems() { return addNewItems_(true); }
function addNewChecklistItems() { return addNewItems_(false); }

function addNewItems_(dryRun) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), out = [];
  ALLOWED_BRANCHES.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { out.push(name + ': ไม่พบแท็บ — ข้าม'); return; }
    var layout = readLayout_(sh);
    if (layout.error) { out.push(name + ': ' + layout.error + ' — ข้าม'); return; }

    var todoByCat = layout.blocks.map(function (b, c) {
      return NEW_ITEMS.filter(function (n) {
        return n.cat === c && !b.items.some(function (it) { return norm_(it.label) === norm_(n.text); });
      });
    });
    var added = [];
    todoByCat.forEach(function (todo, c) { todo.forEach(function (n) { added.push('หมวด ' + (c + 1) + ': ' + n.text); }); });

    if (!dryRun) {
      // Insert from the LAST category upwards so earlier row numbers stay valid.
      for (var c = layout.blocks.length - 1; c >= 0; c--) {
        var block = layout.blocks[c], todo = todoByCat[c];
        if (!todo.length) continue;
        var tmpl = block.items.length ? block.items[block.items.length - 1].row : block.totalRow - 1;
        todo.forEach(function (n, k) {
          var at = block.totalRow + k;              // the total row keeps moving down
          sh.insertRowBefore(at);
          var cols = sh.getMaxColumns();
          var src = sh.getRange(tmpl, 1, 1, cols), dst = sh.getRange(at, 1, 1, cols);
          src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
          src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
          sh.setRowHeight(at, sh.getRowHeight(tmpl));
          if (sh.getRange(tmpl, 6).isPartOfMerge()) { try { sh.getRange(at, 6, 1, 4).merge(); } catch (e) {} }
          sh.getRange(at, 1).setValue(n.text);
          sh.getRange(at, 2, 1, 4).setValues([[false, false, '', false]]);   // B ผ่าน, C ไม่ผ่าน, D แก้ไข, E N/A
          sh.getRange(at, 6).setValue('');
        });
      }
    }

    // Totals, labels and grade from the resulting layout.
    var L = dryRun ? layout : readLayout_(sh);
    var counts = L.blocks.map(function (b, c) { return b.items.length + (dryRun ? todoByCat[c].length : 0); });
    var full = counts.reduce(function (s, n) { return s + n; }, 0), g = gradeThresholds_(full);
    if (!dryRun) {
      L.blocks.forEach(function (b, c) { sh.getRange(b.totalRow, 1).setValue('รวมคะแนน คะแนนเต็ม ' + counts[c]); });
      if (L.grandTotalRow > 0) {
        var gt = L.grandTotalRow, f = L.firstItemRow, l = L.lastItemRow;
        sh.getRange(gt, 1).setValue('รวมคะแนนทั้งหมด คะแนนเต็ม ' + full);
        sh.getRange(gt, 2).setFormula('=COUNTIF(B' + f + ':B' + l + ', TRUE)');
        sh.getRange(gt, 3).setFormula('=COUNTIF(C' + f + ':C' + l + ', TRUE)');
        sh.getRange('H2').setFormula('=IF(B' + gt + '=' + g.great + ',"🏆 ยอดเยี่ยม",\n IF(B' + gt + '>=' + g.veryGood + ',"⭐ ดีมาก",\n IF(B' + gt + '>=' + g.good + ',"👍 ดี",\n IF(B' + gt + '>=' + g.improve + ',"⚠️ ต้องปรับปรุง",\n "❌ ไม่ผ่านมาตรฐาน"))))');
      }
      var f3 = sh.getRange('F3');
      if (/คะแนนเต็ม/.test(String(f3.getValue()))) f3.setValue('(คะแนนเต็ม ' + full + ' คะแนน)   ไม่ควรต่ำกว่า ' + g.veryGood + ' คะแนน');
    }
    out.push(name + ': ' + (added.length ? (dryRun ? 'จะเพิ่ม ' : 'เพิ่มแล้ว ') + added.length + ' ข้อ — ' + added.join(' | ') : 'มีครบแล้ว ไม่ต้องเพิ่ม') +
      ' · คะแนนเต็ม ' + full + ' (เกณฑ์ไม่ต่ำกว่า ' + g.veryGood + ')');
  });
  var msg = (dryRun ? '[ตัวอย่าง — ยังไม่ได้แก้ชีต]\n' : '[แก้ชีตแล้ว]\n') + out.join('\n');
  Logger.log(msg);
  return msg;
}

/* ======================= helpers ======================= */

// "2026-10-12" -> "12/10/2569" (format the daily summary parses); anything else is kept as-is.
function thaiDate_(v) {
  var m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '/' + m[2] + '/' + (Number(m[1]) + 543) : String(v).trim();
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
