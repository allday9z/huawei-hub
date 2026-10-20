/**
 * Huawei Morning Store Checklist — อีเมลสรุปรายวัน 12:00 (sendDailyReport)
 * ---------------------------------------------------------------------------
 * วางไฟล์นี้เป็น "ไฟล์ใหม่" ในโปรเจกต์ Apps Script ของชีต Huawei Morning Store Check list
 * (กด + > สคริปต์ > ตั้งชื่อ DailyReport) ห้ามวางทับไฟล์ตัวรับข้อมูลจากเว็บ (doPost)
 *
 * ตัวตั้งเวลาเดิมเรียกฟังก์ชันชื่อ sendDailyReport อยู่แล้ว บันทึกไฟล์นี้แล้วรอบ 12:00 จะกลับมาส่งเอง
 * ถ้าตัวตั้งเวลาหาย ให้เลือกฟังก์ชัน installDailyTrigger แล้วกด Run หนึ่งครั้ง
 * ทดสอบโดยไม่ส่งถึงทุกคน: เลือก previewDailyReport แล้วกด Run (ส่งถึงเจ้าของสคริปต์คนเดียว)
 *
 * อ่านข้อมูลจากแต่ละแท็บสาขาแบบค้นหาจากข้อความในคอลัมน์ A
 * เพราะแต่ละแท็บมีแถวว่างแทรกไม่เหมือนกัน (บางแท็บรวมคะแนนอยู่แถว 33 บางแท็บแถว 34)
 *
 * ปรับเพื่อให้เข้ากับ ChecklistWebhook.gs v3 (2026-10-20)
 *   v3 เพิ่มรายการตรวจ 5 ข้อใหม่เข้าไปในทุกแท็บสาขา (addNewChecklistItems) ทำให้ "คะแนนเต็ม" ต่อสาขา
 *   ไม่ใช่ 20 อีกต่อไป ไฟล์นี้เลยไม่ hardcode FULL_SCORE/MIN_SCORE แบบตายตัวเหมือนก่อน — แต่จะอ่านคำว่า
 *   "คะแนนเต็ม N" จากแถว "รวมคะแนนทั้งหมด" ในชีตจริงแทน (ตรงกับที่ v3 เขียนไว้ให้อัตโนมัติ) แล้วคำนวณ
 *   เกณฑ์ "ไม่ควรต่ำกว่า" เป็น 90% ของคะแนนเต็มที่อ่านได้ ตัวแปร FULL_SCORE/MIN_SCORE ด้านล่างนี้ยังมีไว้
 *   เป็นค่าสำรอง (ใช้ตอนอ่านชีตไม่เจอตัวเลขจริง ๆ) เท่านั้น — ไม่ต้องแก้มือทุกครั้งที่เพิ่ม/ลดรายการตรวจอีก
 */

// ลำดับสาขาในอีเมล (ต้องตรงกับชื่อแท็บ)
var REPORT_BRANCHES = ['HMD-CWN', 'HES-KBI', 'HMD-CCS', 'HMD-EMQ', 'HES-TMN', 'HMD-HKT', 'HMD-MVH', 'HMD-KKC', 'HMD-CNV'];

// ผู้รับชุดเดียวกับอีเมลเดิม
var REPORT_TO = [
  'benyapha@uficon.com', 'wetaga@uficon.com', 'verapat.T@uficon.com',
  'hmdhktbyuficon@gmail.com', 'hestmnbyuficon@gmail.com', 'hmdemqbyuficon@gmail.com',
  'hmdccsbyuficon@gmail.com', 'hmdmvhbyuficon@gmail.com', 'hmdcwnbyuficon@gmail.com',
  'heskbibyuficon@gmail.com', 'hmdkkcbyuficon@gmail.com', 'songklod.p@uficon.net',
  'Sarayut.N@uficon.net', 'hmdcnvbyuficon@gmail.com'
];
var REPORT_CC = ['wasita@uficon.com', 'pmuficon@uficon.com', 'Pichayapa.R@uficon.com'];

// ค่าสำรอง ใช้เฉพาะตอนอ่าน "คะแนนเต็ม N" จากชีตไม่เจอ (ปกติจะถูกแทนที่ด้วยค่าที่อ่านได้จริงเสมอ)
var FULL_SCORE = 25;
var MIN_SCORE  = 23;
var REPORT_HOUR = 12;

// หน้าตาอีเมล: 'E' สไตล์เดียวกับหน้าพอร์ทัล (แนะนำ), 'D' ฉบับสั้น อ่านจบในหน้าเดียว (แนะนำ), 'A' แถบแดง + การ์ดทุกสาขา, 'B' กระดานคะแนน 3x3, 'C' สรุปผู้บริหาร
var EMAIL_STYLE = 'E';

// เก็บคะแนนรายวันลงแท็บ "Daily Log" ด้วยไหม (ปิดไว้ก่อน เพราะจะเพิ่มแท็บใหม่ในชีต)
var SAVE_LOG = false;
var LOG_SHEET = 'Daily Log';


/* ===================== ฟังก์ชันที่ตัวตั้งเวลาเรียก ===================== */

function sendDailyReport() {
  var report = buildDailyReport_();
  MailApp.sendEmail({
    to: REPORT_TO.join(','),
    cc: REPORT_CC.join(','),
    subject: report.subject,
    body: report.text,
    htmlBody: report.html,
    name: 'Huawei Morning Store Checklist'
  });
  if (SAVE_LOG) {
    try { saveToLog(report.rows); } catch (e) { console.warn('saveToLog: ' + e); }
  }
}

// ทดสอบ: ส่งถึงเจ้าของสคริปต์คนเดียว
function previewDailyReport() {
  var report = buildDailyReport_();
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: '[ทดสอบ] ' + report.subject,
    body: report.text,
    htmlBody: report.html,
    name: 'Huawei Morning Store Checklist'
  });
}

// สร้างตัวตั้งเวลา 12:00 ใหม่ (ลบของเดิมที่เรียก sendDailyReport ก่อน กันส่งซ้ำ)
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReport').timeBased().everyDays(1).atHour(REPORT_HOUR)
    .inTimezone('Asia/Bangkok').create();
}

// บันทึกคะแนนรายวัน (ใช้เมื่อ SAVE_LOG = true)
function saveToLog(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.appendRow(['วันที่', 'สาขา', 'ส่งวันนี้', 'ผู้ตรวจ', 'คะแนน', 'ข้อที่ไม่ผ่าน', 'หมายเหตุ']);
    sh.setFrozenRows(1);
  }
  var today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var out = rows.map(function (r) {
    return [today, r.branch, r.isToday ? 'ใช่' : 'ไม่', r.inspector, r.score == null ? '' : r.score,
            r.fails.map(function (f) { return f.item; }).join(' | '), r.notes.join(' / ')];
  });
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
}


/* ===================== อ่านข้อมูลจากแท็บสาขา ===================== */

function readBranch_(ss, name, today) {
  var sh = ss.getSheetByName(name);
  if (!sh) return { branch: name, missing: true, fails: [], notes: [] };
var last = Math.min(sh.getLastRow(), 60);
  var vals = sh.getRange(1, 1, last, 6).getValues();         // A:F
  var disp = sh.getRange(1, 1, last, 6).getDisplayValues();

  var r = { branch: name, gid: sh.getSheetId(), inspector: '', score: null, fullScore: null, fails: [], notes: [], sheetDate: '', isToday: true };

  // ผู้ตรวจ: แถวที่คอลัมน์ A ขึ้นต้นด้วย "ผู้ตรวจสอบ"
  // วันที่: อยู่ใน D2 หรือ E2 แล้วแต่แท็บ เป็นข้อความหรือวันที่ก็ได้
  var dateCells = [];
  for (var i = 0; i < Math.min(last, 4); i++) {
    var a = String(disp[i][0]).trim();
    if (/^ผู้ตรวจสอบ/.test(a)) r.inspector = String(disp[i][1]).replace(/^\s*ชื่อ\s*/, '').trim();
    if (/^สาขา/.test(a)) dateCells.push(vals[i][3], vals[i][4]);
  }
  var parsed = dateCells.map(parseSheetDate_).filter(function (d) { return d; });
  if (parsed.length) {
    var hit = parsed.filter(function (d) { return sameDay_(d, today); })[0];
    r.isToday = !!hit;
    var d0 = hit || parsed[0];
    r.sheetDate = pad2_(d0.d) + '/' + pad2_(d0.m) + '/' + (d0.y + 543);
  } // อ่านวันที่ไม่ออก = ถือว่าเป็นของวันนี้ ไม่แจ้งเตือนผิด

  // ไล่ตั้งแต่หัวตาราง "รายการตรวจสอบ" จนถึง "รวมคะแนนทั้งหมด"
  var start = 0, totalRow = -1, passCount = 0;
  for (i = 0; i < last; i++) {
    if (/^รายการตรวจสอบ/.test(String(disp[i][0]).trim())) { start = i + 1; break; }
  }
  for (i = start; i < last; i++) {
    var label = String(disp[i][0]).trim();
    if (/^รวมคะแนนทั้งหมด/.test(label)) { totalRow = i; break; }

    var note = String(disp[i][5]).replace(/\s*\n\s*\n\s*/g, '\n').trim();  // ตัดบรรทัดว่างซ้อน
    if (note) r.notes.push(note);

    if (!label || /^รวมคะแนน/.test(label)) continue;
    var pass = vals[i][1] === true, fail = vals[i][2] === true;
    if (pass) passCount++;
    if (fail) {
      var detail = [disp[i][3], disp[i][4]].map(function (s) { return String(s).trim(); })
        .filter(function (s) { return s; }).join(' / ');
      r.fails.push({ item: label, detail: detail });
    }
  }
  var total = totalRow >= 0 ? Number(String(disp[totalRow][1]).replace(/[^\d.]/g, '')) : NaN;
  r.score = isFinite(total) && String(disp[totalRow] && disp[totalRow][1]).trim() !== '' ? total : passCount;

  // อ่าน "คะแนนเต็ม N" จากข้อความในคอลัมน์ A ของแถว "รวมคะแนนทั้งหมด" เอง (v3 เขียนให้อัตโนมัติ
  // ทุกครั้งที่ addNewChecklistItems() ทำงาน) เพื่อไม่ต้องมานั่งอัปเดตค่าคงที่ FULL_SCORE มือทุกครั้ง
  if (totalRow >= 0) {
    var fullMatch = String(disp[totalRow][0]).match(/เต็ม\s*(\d+)/);
    if (fullMatch) r.fullScore = Number(fullMatch[1]);
  }
  return r;
}

// รองรับ: วันที่จริง, "วันที่ 12/10/69", "12/10/2026", "12/10/2569", และวันที่ที่ชีตแปลงปี 69 เป็น 1969
function parseSheetDate_(v) {
  if (v === '' || v == null) return null;
  var d, m, y;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    var s = Utilities.formatDate(v, 'Asia/Bangkok', 'd/M/yyyy').split('/');
    d = +s[0]; m = +s[1]; y = +s[2];
  } else {
    var mt = String(v).match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2,4})/);
    if (!mt) return null;
    d = +mt[1]; m = +mt[2]; y = +mt[3];
  }
  if (y < 100) y = y >= 50 ? y + 2500 : y + 2000;   // 69 → 2569 (พ.ศ.), 26 → 2026
  else if (y < 2000) y = (y % 100) + 2500;          // 1969 → 2569 (ชีตแปลงปีผิด)
  if (y > 2400) y -= 543;                           // พ.ศ. → ค.ศ.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { d: d, m: m, y: y };
}
function todayParts_() {
  var s = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd/M/yyyy').split('/');
  return { d: +s[0], m: +s[1], y: +s[2] };
}
function sameDay_(a, b) { return a.d === b.d && a.m === b.m && a.y === b.y; }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  }).replace(/\n/g, '<br>');
}


/* ===================== สร้างอีเมล ===================== */

function buildDailyReport_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var base = ss.getUrl().replace(/\/edit.*$/, '') + '/edit#gid=';
  var t = todayParts_();
  var dateTH = pad2_(t.d) + '/' + pad2_(t.m) + '/' + (t.y + 543);
var rows = REPORT_BRANCHES.map(function (b) { return readBranch_(ss, b, t); });

  // คะแนนเต็มจริงของวันนี้: เอาค่าที่พบมากที่สุดในบรรดาสาขาที่อ่านได้ (กันกรณีบางแท็บยังไม่ได้รัน
  // addNewChecklistItems() แล้วค่าเพี้ยนไปสาขาเดียว) ถ้าอ่านไม่ได้เลยสักสาขา ใช้ค่าสำรอง FULL_SCORE ด้านบน
  var fullCounts = {};
  rows.forEach(function (r) { if (r.fullScore) fullCounts[r.fullScore] = (fullCounts[r.fullScore] || 0) + 1; });
  var detectedFull = Object.keys(fullCounts).sort(function (a, b) { return fullCounts[b] - fullCounts[a]; })[0];
  if (detectedFull) {
    FULL_SCORE = Number(detectedFull);
    MIN_SCORE = Math.round(FULL_SCORE * 0.9);
  }

  var done = rows.filter(function (r) { return !r.missing && r.isToday; });
  var full = done.filter(function (r) { return r.score >= FULL_SCORE; }).length;
  var avg = done.length ? done.reduce(function (s, r) { return s + (r.score || 0); }, 0) / done.length : 0;
  var pending = rows.filter(function (r) { return r.missing || !r.isToday; });

  var subject = 'Huawei Morning Store Checklist — สรุปทุกสาขา (' + dateTH + ')';

  // ---------- HTML (ดีไซน์ใหม่: โทนแดง HUAWEI ไม่มีอีโมจิ ใช้ตารางเพื่อให้แสดงผลเหมือนกันทุกแอปอีเมล) ----------
  var RED = '#C7000B', INK = '#1D1D1F', MUTED = '#6E6E73', LINE = '#ECECEF', BG = '#F5F5F7';
  var FONT = "font-family:'Segoe UI','Noto Sans Thai','Leelawadee UI',Tahoma,Arial,sans-serif;";
  var DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  var MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var longDate = 'วัน' + DAYS[new Date(t.y, t.m - 1, t.d).getDay()] + 'ที่ ' + t.d + ' ' + MONTHS[t.m - 1] + ' ' + (t.y + 543);

  // สถานะของแต่ละสาขา: สี, ป้าย
  var ST = {
    full:    { c: '#1B7F3B', bg: '#E7F5EC', label: 'คะแนนเต็ม' },
    pass:    { c: '#A15C00', bg: '#FFF3DC', label: 'ผ่านเกณฑ์' },
    low:     { c: RED,       bg: '#FDE7E8', label: 'ต่ำกว่าเกณฑ์' },
    pending: { c: '#6E6E73', bg: '#F0F0F2', label: 'ยังไม่ส่ง' },
    missing: { c: '#6E6E73', bg: '#F0F0F2', label: 'ไม่พบแท็บ' }
  };
  rows.forEach(function (r) {
    r.st = r.missing ? 'missing' : !r.isToday ? 'pending' : r.score >= FULL_SCORE ? 'full' : r.score >= MIN_SCORE ? 'pass' : 'low';
  });
  var watch = rows.filter(function (r) { return r.st !== 'full'; });
  var low = rows.filter(function (r) { return r.st === 'low'; }).length;

  var badge = function (st, txt) {
    var s = ST[st];
    return '<span style="display:inline-block;background:' + s.bg + ';color:' + s.c + ';font-size:12px;font-weight:600;line-height:20px;padding:0 10px;border-radius:10px;white-space:nowrap;">' + (txt || s.label) + '</span>';
  };
  var bar = function (score, st) {
    var pct = Math.max(0, Math.min(100, Math.round((score || 0) / FULL_SCORE * 100)));
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' +
      '<td width="' + pct + '%" style="background:' + ST[st].c + ';height:4px;line-height:4px;font-size:0;border-radius:2px;">&nbsp;</td>' +
      (pct < 100 ? '<td style="background:' + LINE + ';height:4px;line-height:4px;font-size:0;">&nbsp;</td>' : '') +
      '</tr></table>';
  };
  var kpi = function (val, label, color, last) {
    return '<td width="33%" align="center" style="padding:16px 8px;' + (last ? '' : 'border-right:1px solid ' + LINE + ';') + '">' +
      '<div style="font-size:26px;font-weight:700;line-height:32px;color:' + color + ';">' + val + '</div>' +
      '<div style="font-size:12px;color:' + MUTED + ';margin-top:2px;">' + label + '</div></td>';
  };
  var section = function (title, right) {
    return '<tr><td style="padding:22px 24px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="font-size:13px;font-weight:700;color:' + INK + ';letter-spacing:.2px;">' + title + '</td>' +
      '<td align="right" style="font-size:12px;color:' + MUTED + ';">' + (right || '') + '</td></tr></table></td></tr>';
  };
// ภาพรวมทุกสาขา (ตารางสั้น)
  var overview = rows.map(function (r, i) {
    var score = (r.st === 'pending' || r.st === 'missing') ? '–' : r.score + '<span style="color:' + MUTED + ';font-weight:400;">/' + FULL_SCORE + '</span>';
    return '<tr>' +
      '<td style="padding:10px 0;border-top:' + (i ? '1px solid ' + LINE : '0') + ';font-size:14px;font-weight:600;color:' + INK + ';white-space:nowrap;" width="90">' + esc_(r.branch) + '</td>' +
      '<td style="padding:10px 8px;border-top:' + (i ? '1px solid ' + LINE : '0') + ';font-size:13px;color:' + MUTED + ';">' + esc_(r.st === 'pending' ? 'ยังไม่อัปเดตของวันนี้' : r.st === 'missing' ? 'ไม่พบแท็บในชีต' : (r.inspector || '-')) + '</td>' +
      '<td style="padding:10px 0;border-top:' + (i ? '1px solid ' + LINE : '0') + ';" width="70">' + ((r.st === 'pending' || r.st === 'missing') ? '' : bar(r.score, r.st)) + '</td>' +
      '<td align="right" style="padding:10px 0 10px 12px;border-top:' + (i ? '1px solid ' + LINE : '0') + ';font-size:14px;font-weight:700;color:' + ST[r.st].c + ';white-space:nowrap;" width="52">' + score + '</td>' +
      '</tr>';
  }).join('');

  // การ์ดรายละเอียดของแต่ละสาขา
  var cards = rows.map(function (r) {
    var s = ST[r.st];
    var inner = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="font-size:15px;font-weight:700;color:' + INK + ';">' + esc_(r.branch) + '</td>' +
      '<td align="right">' + badge(r.st, (r.st === 'pending' || r.st === 'missing') ? '' : r.score + '/' + FULL_SCORE + ' · ' + s.label) + '</td></tr></table>';
    if (r.st === 'missing') {
      inner += '<div style="font-size:13px;color:' + MUTED + ';margin-top:6px;">ไม่พบแท็บชื่อนี้ในชีต</div>';
    } else if (r.st === 'pending') {
      inner += '<div style="font-size:13px;color:' + MUTED + ';margin-top:6px;">ยังไม่อัปเดต Checklist ของวันนี้' + (r.sheetDate ? ' · ข้อมูลล่าสุดในชีตเป็นของวันที่ ' + r.sheetDate : '') + '</div>';
    } else {
      inner += '<div style="font-size:13px;color:' + MUTED + ';margin-top:4px;">ผู้ตรวจ ' + esc_(r.inspector || '-') + '</div>';
      if (r.fails.length) {
        inner += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;"><tr><td style="background:#FDF2F2;border-radius:8px;padding:10px 12px;">' +
          '<div style="font-size:12px;font-weight:700;color:' + RED + ';">ไม่ผ่าน ' + r.fails.length + ' ข้อ</div>' +
          r.fails.map(function (f) {
            return '<div style="font-size:13px;color:' + INK + ';margin-top:6px;line-height:1.5;">' + esc_(f.item) + '</div>' +
              (f.detail ? '<div style="font-size:12px;color:#8A4B00;line-height:1.5;">' + esc_(f.detail) + '</div>' : '');
          }).join('') + '</td></tr></table>';
      }
      if (r.notes.length) inner += '<div style="margin-top:12px;">' + notesBlock_(r.notes) + '</div>';
    }
    if (!r.missing) {
      inner += '<div style="margin-top:12px;"><a href="' + base + r.gid + '" style="font-size:13px;font-weight:600;color:' + RED + ';text-decoration:none;">เปิด Checklist ของสาขา &rarr;</a></div>';
    }
    return '<tr><td style="padding:0 24px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + LINE + ';border-radius:12px;border-collapse:separate;">' +
      '<tr><td width="4" style="background:' + s.c + ';border-radius:12px 0 0 12px;font-size:0;">&nbsp;</td>' +
      '<td style="padding:14px 16px;">' + inner + '</td></tr></table></td></tr>';
  }).join('');
// แถบสรุปสิ่งที่ต้องติดตาม
  var watchBox = watch.length
    ? '<tr><td style="padding:16px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#FFF6F6;border:1px solid #F6D3D5;border-radius:10px;padding:12px 14px;">' +
        '<div style="font-size:13px;font-weight:700;color:' + RED + ';">ต้องติดตามวันนี้ ' + watch.length + ' สาขา</div>' +
        '<div style="font-size:13px;color:' + INK + ';margin-top:4px;line-height:1.6;">' + watch.map(function (r) {
          var why = r.st === 'pending' ? 'ยังไม่ส่ง' : r.st === 'missing' ? 'ไม่พบแท็บ' : r.score + '/' + FULL_SCORE + (r.fails.length ? ' · ไม่ผ่าน ' + r.fails.length + ' ข้อ' : '');
          return '<b>' + esc_(r.branch) + '</b> <span style="color:' + MUTED + ';">' + why + '</span>';
        }).join('<br>') + '</div></td></tr></table></td></tr>'
    : '<tr><td style="padding:16px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#EFF8F2;border:1px solid #CFE9D8;border-radius:10px;padding:12px 14px;font-size:13px;color:#1B7F3B;font-weight:600;">ทุกสาขาได้คะแนนเต็มวันนี้</td></tr></table></td></tr>';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:' + BG + ';' + FONT + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + BG + ';"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;' + FONT + '">' +

    // หัวอีเมล: แถบแดงเต็มความกว้าง
    '<tr><td style="background:' + RED + ';background-image:linear-gradient(120deg,#C7000B,#E0242E);padding:22px 24px 20px;">' +
      '<div style="font-size:12px;font-weight:600;color:#FADADC;letter-spacing:1px;">HUAWEI HUB BY UFICON</div>' +
      '<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;line-height:28px;">Morning Store Checklist</div>' +
      '<div style="font-size:14px;color:#FFE9EA;margin-top:4px;">สรุปทุกสาขา · ' + longDate + '</div>' +
    '</td></tr>' +

    // ตัวเลขหลัก
    '<tr><td style="padding:0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ' + LINE + ';"><tr>' +
      kpi(done.length + '<span style="font-size:15px;color:' + MUTED + ';font-weight:600;">/' + rows.length + '</span>', 'สาขาที่ส่งแล้ว', INK) +
      kpi(full, 'ได้คะแนนเต็ม', '#1B7F3B') +
      kpi(avg.toFixed(2), 'คะแนนเฉลี่ย', low ? RED : INK, true) +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:10px 24px 0;font-size:12px;color:' + MUTED + ';">เกณฑ์ประเมิน: คะแนนเต็ม ' + FULL_SCORE + ' · ไม่ควรต่ำกว่า ' + MIN_SCORE + ' คะแนน</td></tr>' +

    watchBox +

    section('ภาพรวมทุกสาขา', 'คะแนน') +
    '<tr><td style="padding:0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + overview + '</table></td></tr>' +

    section('รายละเอียดแต่ละสาขา') + cards +

    // ท้ายอีเมล
    '<tr><td style="padding:12px 24px 22px;border-top:1px solid ' + LINE + ';font-size:12px;color:' + MUTED + ';line-height:1.6;">' +
      'ส่งอัตโนมัติเวลา 12:00 น. ทุกวัน จากชีต Huawei Morning Store Check list<br>' +
      '<a href="' + base + '0" style="color:' + MUTED + ';">เปิดชีตทั้งหมด</a> · ' +
      '<a href="https://huawei-hub.coolify.pve01.prod.uficon.com/" style="color:' + MUTED + ';">HUAWEI Hub Portal</a>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';

  if (EMAIL_STYLE === 'B' || EMAIL_STYLE === 'C' || EMAIL_STYLE === 'D' || EMAIL_STYLE === 'E') html = buildHtmlAlt_(EMAIL_STYLE, rows, done, full, avg, base, t, longDate);
// ---------- ข้อความธรรมดา (สำหรับแอปอีเมลที่ไม่แสดง HTML) ----------
  var text = '📅 Huawei Morning Store Checklist — สรุปทุกสาขา (' + dateTH + ')\n\n' + rows.map(function (r) {
    if (r.missing) return '⛔ ' + r.branch + ' | ไม่พบแท็บ\n';
    if (!r.isToday) return '⏳ ' + r.branch + ' | ยังไม่ส่ง Checklist วันนี้' + (r.sheetDate ? ' (ข้อมูลในชีต ' + r.sheetDate + ')' : '') + '\n    ดู Checklist: ' + base + r.gid + '\n';
    var icon = r.score >= FULL_SCORE ? '✅' : r.score >= MIN_SCORE ? '⚠️' : '❌';
    return icon + ' ' + r.branch + ' | ' + r.score + '/' + FULL_SCORE + '\n    ผู้ตรวจ: ' + (r.inspector || '-') +
      (r.fails.length ? '\n    ไม่ผ่าน: ' + r.fails.map(function (f) { return f.item + (f.detail ? ' (' + f.detail + ')' : ''); }).join(' | ') : '') +
      (r.notes.length ? '\n    หมายเหตุ: ' + r.notes.join(' / ') : '') +
      '\n    ดู Checklist: ' + base + r.gid + '\n';
  }).join('\n') +
    '\n📊 ภาพรวม: ' + done.length + ' สาขา | ได้ ' + FULL_SCORE + '/' + FULL_SCORE + ' จำนวน ' + full + ' สาขา | เฉลี่ย ' + avg.toFixed(2) + '/' + FULL_SCORE +
    (pending.length ? ' | ยังไม่ส่ง ' + pending.length + ' สาขา' : '') +
    '\n\n🤖 รายงานนี้ถูกส่งอัตโนมัติเวลา 12:00 น. ทุกวัน';

  return { subject: subject, html: html, text: text, rows: rows };
}


/* ===================== ดีไซน์ทางเลือก B และ C ===================== */
// เลือกแบบที่ EMAIL_STYLE ด้านบนไฟล์: 'A' แถบแดง+การ์ด, 'B' กระดานคะแนน, 'C' สรุปผู้บริหาร
function buildHtmlAlt_(style, rows, done, full, avg, base, t, longDate) {
  var RED = '#C7000B', INK = '#1D1D1F', MUTED = '#6E6E73', LINE = '#ECECEF', BG = '#F5F5F7';
  var FONT = "font-family:'Segoe UI','Noto Sans Thai','Leelawadee UI',Tahoma,Arial,sans-serif;";
  var ST = {
    full:    { c: '#1B7F3B', bg: '#E9F6EE', label: 'คะแนนเต็ม' },
    pass:    { c: '#A15C00', bg: '#FFF2DB', label: 'ผ่านเกณฑ์' },
    low:     { c: RED,       bg: '#FDE7E8', label: 'ต่ำกว่าเกณฑ์' },
    pending: { c: '#8E8E93', bg: '#F2F2F4', label: 'ยังไม่ส่ง' },
    missing: { c: '#8E8E93', bg: '#F2F2F4', label: 'ไม่พบแท็บ' }
  };
  var noScore = function (r) { return r.st === 'pending' || r.st === 'missing'; };
  var watch = rows.filter(function (r) { return r.st !== 'full'; });
  var link = function (r, txt, color) {
    return r.missing ? '' : '<a href="' + base + r.gid + '" style="color:' + (color || RED) + ';text-decoration:none;font-weight:600;">' + (txt || 'เปิด Checklist &rarr;') + '</a>';
  };
  var failsHtml = function (r) {
    return r.fails.map(function (f) {
      return '<div style="font-size:13px;color:' + INK + ';line-height:1.5;margin-top:6px;">' + esc_(f.item) + '</div>' +
        (f.detail ? '<div style="font-size:12px;color:#8A4B00;line-height:1.5;">' + esc_(f.detail) + '</div>' : '');
    }).join('');
  };
  var wrap = function (inner) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="margin:0;padding:0;background:' + BG + ';' + FONT + '">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + BG + ';"><tr><td align="center" style="padding:24px 12px;">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;' + FONT + '">' +
      inner +
      '<tr><td style="padding:14px 24px 22px;border-top:1px solid ' + LINE + ';font-size:12px;color:' + MUTED + ';line-height:1.6;">' +
      'ส่งอัตโนมัติเวลา 12:00 น. ทุกวัน · <a href="' + base + '0" style="color:' + MUTED + ';">เปิดชีตทั้งหมด</a> · ' +
      '<a href="https://huawei-hub.coolify.pve01.prod.uficon.com/" style="color:' + MUTED + ';">HUAWEI Hub Portal</a></td></tr>' +
      '</table></td></tr></table></body></html>';
  };
  var notesHtml = function (r) {
    return notesBlock_(r.notes);
  };
/* ---------- E: สไตล์เดียวกับหน้าแรก HUAWEI Hub (การ์ดแถบแดง + รายการแบบแอป) ---------- */
  if (style === 'E') {
    var PAPER = '#F5F5F7';
    var FONTE = "font-family:'IBM Plex Sans Thai','Segoe UI','Noto Sans Thai','Leelawadee UI',Tahoma,Arial,sans-serif;";
    var eo = { missing: 0, pending: 1, low: 2, pass: 3, full: 4 };
    var items = rows.slice().sort(function (a, b) {
      return (eo[a.st] - eo[b.st]) || (REPORT_BRANCHES.indexOf(a.branch) - REPORT_BRANCHES.indexOf(b.branch));
    });
    var cut = function (x, n) { if (x.length <= n) return x; var c = x.slice(0, n), sp = c.lastIndexOf(' '); return (sp > n - 15 ? c.slice(0, sp) : c) + '…'; };
    var highlight = function (r) {
      var pts = splitNotes_(r.notes).points;
      var p = pts.filter(function (x) { return /(ยอด|target|เป้า)/i.test(x); })[0] || pts[0];
      return p ? cut(p, 70) : '';
    };
    // หมายเหตุครบทุกข้อ: แต่ละข้อเป็น bullet, เรื่องกะพนักงานรวมไว้บรรทัด "กะวันนี้"
    var notesBullets = function (r) {
      var n = splitNotes_(r.notes);
      if (!n.points.length && !n.shifts.length) return '';
      var h = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr><td style="padding-left:56px;">';
      if (n.points.length) {
        h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + n.points.map(function (p) {
          return '<tr><td width="14" valign="top" style="font-size:14px;line-height:22px;color:' + RED + ';">&bull;</td>' +
            '<td valign="top" style="font-size:14px;line-height:22px;color:#2C2C2E;padding-bottom:3px;">' + esc_(p) + '</td></tr>';
        }).join('') + '</table>';
      }
      if (n.shifts.length) {
        h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr><td style="background:' + PAPER + ';border-radius:10px;padding:8px 12px;font-size:13px;line-height:20px;color:#3A3A3C;">' +
          '<b style="color:' + INK + ';">กะวันนี้</b>&nbsp;&nbsp;' + n.shifts.map(esc_).join(' <span style="color:#C7C7CC;">|</span> ') + '</td></tr></table>';
      }
      return h + '</td></tr></table>';
    };
    var card = function (inner, pad) {
      return '<tr><td style="padding:0 0 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ' + LINE + ';border-radius:20px;border-collapse:separate;overflow:hidden;">' +
        '<tr><td style="padding:' + (pad || '18px 20px') + ';">' + inner + '</td></tr></table></td></tr>';
    };
    var label = function (txt) {
      return '<tr><td style="padding:6px 4px 8px;font-size:13px;font-weight:700;color:' + MUTED + ';letter-spacing:.3px;">' + txt + '</td></tr>';
    };
// การ์ดเด่น
    var pctSent = Math.round(done.length / rows.length * 100);
    var title = !done.length ? 'ยังไม่มีสาขาใดส่ง Checklist' : full === rows.length ? 'ทุกสาขาได้คะแนนเต็ม' : 'คะแนนเต็ม ' + full + ' จาก ' + rows.length + ' สาขา';
    var desc = watch.length ? 'ต้องติดตาม ' + watch.map(function (r) { return r.branch; }).join(', ') : 'ไม่มีสาขาที่ต้องติดตามวันนี้';
    var hero =
      '<tr><td style="padding:0 0 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ' + LINE + ';border-radius:24px;border-collapse:separate;overflow:hidden;">' +
      '<tr><td style="background:' + RED + ';background-image:linear-gradient(120deg,#C7000B,#E0242E);padding:14px 22px 38px;font-size:14px;font-weight:600;color:#ffffff;border-radius:24px 24px 0 0;">' +
        'Morning Store Checklist &nbsp;·&nbsp; ' + longDate + '</td></tr>' +
      '<tr><td style="padding:0 22px 22px;">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:-32px;"><tr><td align="center" valign="middle" style="background:' + RED + ';border-radius:16px;border:4px solid #ffffff;color:#ffffff;padding:8px 14px 7px;">' +
          '<div style="font-size:22px;line-height:26px;font-weight:700;">' + (done.length ? avg.toFixed(2) : '–') + '</div>' +
          '<div style="font-size:11px;line-height:14px;color:#FFE3E5;">คะแนนเฉลี่ย</div></td></tr></table>' +
        '<div style="font-size:24px;line-height:31px;font-weight:700;color:' + INK + ';margin-top:12px;">' + title + '</div>' +
        '<div style="font-size:15px;color:' + (watch.length ? RED : MUTED) + ';margin-top:4px;">' + esc_(desc) + '</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr><td style="background:' + PAPER + ';border-radius:14px;padding:12px 14px;">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
            '<td width="50%" valign="top" style="padding-right:10px;">' +
              '<div style="font-size:13px;font-weight:700;color:#1B7F3B;">คะแนนเต็ม ' + full + ' สาขา</div>' +
              '<div style="font-size:13px;line-height:20px;color:' + INK + ';margin-top:4px;">' + (full ? rows.filter(function (r) { return r.st === 'full'; }).map(function (r) { return esc_(r.branch); }).join('<br>') : '<span style="color:' + MUTED + ';">–</span>') + '</div></td>' +
            '<td width="50%" valign="top" style="padding-left:12px;border-left:1px solid #E3E3E8;">' +
              '<div style="font-size:13px;font-weight:700;color:' + (watch.length ? RED : MUTED) + ';">ต้องติดตาม ' + watch.length + ' สาขา</div>' +
              '<div style="font-size:13px;line-height:20px;color:' + INK + ';margin-top:4px;">' + (watch.length ? watch.map(function (r) {
                return esc_(r.branch) + ' <span style="color:' + ST[r.st].c + ';font-weight:600;">' + (noScore(r) ? ST[r.st].label : r.score + '/' + FULL_SCORE) + '</span>';
              }).join('<br>') : '<span style="color:' + MUTED + ';">ไม่มี</span>') + '</div></td>' +
          '</tr></table>' +
          '<div style="font-size:13px;color:' + MUTED + ';margin-top:12px;">ส่งแล้ว <b style="color:' + INK + ';">' + done.length + '</b> จาก ' + rows.length + ' สาขา</div>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr>' +
            '<td width="' + pctSent + '%" style="background:' + RED + ';height:6px;line-height:6px;font-size:0;border-radius:3px;">&nbsp;</td>' +
            (pctSent < 100 ? '<td style="background:' + LINE + ';height:6px;line-height:6px;font-size:0;">&nbsp;</td>' : '') +
          '</tr></table>' +
          '<div style="font-size:12px;color:' + MUTED + ';margin-top:8px;">เกณฑ์: คะแนนเต็ม ' + FULL_SCORE + ' · ไม่ควรต่ำกว่า ' + MIN_SCORE + '</div>' +
        '</td></tr></table>' +
      '</td></tr></table></td></tr>';
// การ์ดต้องติดตาม
    var attention = watch.length ? label('ต้องติดตาม') + watch.map(function (r) {
      var s = ST[r.st];
      var inner = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td><div style="font-size:17px;font-weight:700;color:' + INK + ';">' + esc_(r.branch) + '</div>' +
        '<div style="font-size:13px;color:' + MUTED + ';margin-top:1px;">' + esc_(noScore(r) ? s.label : 'ผู้ตรวจ ' + (r.inspector || '-')) + '</div></td>' +
        '<td align="right" valign="top"><span style="display:inline-block;background:' + s.bg + ';color:' + s.c + ';font-size:13px;font-weight:700;line-height:24px;padding:0 12px;border-radius:12px;white-space:nowrap;">' +
          (noScore(r) ? s.label : r.score + '/' + FULL_SCORE + ' · ' + s.label) + '</span></td></tr></table>';
      if (r.st === 'pending') inner += '<div style="font-size:14px;color:' + INK + ';margin-top:12px;">ยังไม่ส่ง Checklist ของวันนี้' + (r.sheetDate ? '<span style="color:' + MUTED + ';"> · ข้อมูลล่าสุด ' + r.sheetDate + '</span>' : '') + '</div>';
      r.fails.forEach(function (f) {
        inner += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;"><tr>' +
          '<td width="3" style="background:' + RED + ';border-radius:2px;font-size:0;">&nbsp;</td>' +
          '<td style="padding:2px 0 2px 12px;"><div style="font-size:14px;line-height:21px;color:' + INK + ';">' + esc_(f.item) + '</div>' +
          (f.detail ? '<div style="font-size:13px;line-height:20px;color:#8A4B00;margin-top:2px;">' + esc_(f.detail) + '</div>' : '') + '</td></tr></table>';
      });
      if (!r.missing) inner += '<div style="margin-top:14px;"><a href="' + base + r.gid + '" style="display:inline-block;background:' + RED + ';color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:999px;padding:8px 18px;">เปิด Checklist</a></div>';
      return card(inner);
    }).join('') : '';
// รายการทุกสาขา
    var rowsOf = function (group) { return group.map(function (r, k) {
      var s = ST[r.st];
      var sub = noScore(r) ? s.label : (r.inspector || '-');
      var nb = noScore(r) ? '' : notesBullets(r);
      return '<tr><td style="padding:12px 16px;border-top:' + (k ? '1px solid ' + LINE : '0') + ';">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
          '<td width="44" valign="top"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;border-radius:12px;background:' + s.bg + ';color:' + s.c + ';font-size:16px;font-weight:700;">' + (noScore(r) ? '–' : r.score) + '</td></tr></table></td>' +
          '<td valign="middle" style="padding-left:12px;"><div style="font-size:16px;font-weight:700;color:' + INK + ';line-height:21px;">' + esc_(r.branch) + '</div>' +
            '<div style="font-size:13px;color:' + MUTED + ';line-height:18px;">' + esc_(noScore(r) ? sub : 'ผู้ตรวจ ' + sub) + '</div>' +
            '</td>' +
          '<td align="right" valign="top" style="white-space:nowrap;padding-top:1px;">' + (r.missing ? '' : '<a href="' + base + r.gid + '" style="font-size:13px;font-weight:600;color:' + RED + ';text-decoration:none;">ดูชีต &rsaquo;</a>') + '</td>' +
        '</tr></table>' + failBox(r) + nb + '</td></tr>';
    }).join(''); };
    var failBox = function (r) {
      var h = '';
      if (r.st === 'pending') h += '<div style="font-size:14px;color:' + INK + ';">ยังไม่ส่ง Checklist ของวันนี้' + (r.sheetDate ? '<span style="color:' + MUTED + ';"> · ข้อมูลล่าสุด ' + r.sheetDate + '</span>' : '') + '</div>';
      if (r.fails.length) {
        h += '<div style="font-size:12px;font-weight:700;color:' + RED + ';letter-spacing:.3px;">ไม่ผ่าน ' + r.fails.length + ' ข้อ</div>' +
          r.fails.map(function (f) {
            return '<div style="font-size:14px;line-height:21px;color:' + INK + ';margin-top:4px;">' + esc_(f.item) + '</div>' +
              (f.detail ? '<div style="font-size:13px;line-height:20px;color:#8A4B00;">' + esc_(f.detail) + '</div>' : '');
          }).join('');
      }
      return h ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr><td style="padding-left:56px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#FDF2F2;border-radius:10px;padding:10px 12px;">' + h + '</td></tr></table></td></tr></table>' : '';
    };
    var groupCard = function (title, color, group) {
      return '<tr><td style="padding:6px 4px 8px;"><span style="font-size:15px;font-weight:700;color:' + color + ';">' + title + '</span>' +
        ' <span style="font-size:13px;color:' + MUTED + ';">' + group.length + ' สาขา</span></td></tr>' +
        '<tr><td style="padding:0 0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ' + LINE + ';' +
        (color === RED ? 'border-top:3px solid ' + RED + ';' : 'border-top:3px solid #1B7F3B;') + 'border-radius:20px;border-collapse:separate;">' + rowsOf(group) + '</table></td></tr>';
    };
    var okGroup = items.filter(function (r) { return r.st === 'full'; });
    var watchGroup = items.filter(function (r) { return r.st !== 'full'; });
return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet"></head>' +
      '<body style="margin:0;padding:0;background:#F7EEEF;' + FONTE + '">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7EEEF;background-image:linear-gradient(180deg,#F9E1E2 0%,#F5F5F7 360px);"><tr><td align="center" style="padding:24px 14px 30px;">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;' + FONTE + '">' +
        '<tr><td style="padding:0 4px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
          '<td><div style="font-size:12px;font-weight:700;color:' + RED + ';letter-spacing:1px;">HUAWEI HUB BY UFICON</div>' +
          '<div style="font-size:22px;font-weight:700;color:' + INK + ';margin-top:2px;">สรุปประจำวัน</div></td>' +
          '<td align="right" valign="bottom" style="font-size:13px;color:' + MUTED + ';">ส่งอัตโนมัติ 12:00 น.</td>' +
        '</tr></table></td></tr>' +
        hero +
        (watchGroup.length ? groupCard('ต้องติดตาม', RED, watchGroup) : '') +
        (okGroup.length ? groupCard('คะแนนเต็ม', '#1B7F3B', okGroup) : '') +
        '<tr><td align="center" style="padding:8px 0 4px;"><a href="https://huawei-hub.coolify.pve01.prod.uficon.com/" style="display:inline-block;background:#ffffff;border:1px solid ' + LINE + ';color:' + INK + ';font-size:14px;font-weight:600;text-decoration:none;border-radius:999px;padding:10px 20px;">เปิด HUAWEI Hub</a>' +
          '&nbsp; <a href="' + base + '0" style="display:inline-block;color:' + MUTED + ';font-size:14px;text-decoration:none;padding:10px 8px;">เปิดชีตทั้งหมด</a></td></tr>' +
      '</table></td></tr></table></body></html>';
  }
/* ---------- D: ฉบับสั้น — หนึ่งสาขาหนึ่งบรรทัด หมายเหตุย่อ 2 ข้อแรก ที่เหลือกดดูในชีต ---------- */
  if (style === 'D') {
    var ord = { missing: 0, pending: 1, low: 2, pass: 3, full: 4 };
    var list = rows.slice().sort(function (a, b) {
      return (ord[a.st] - ord[b.st]) || (REPORT_BRANCHES.indexOf(a.branch) - REPORT_BRANCHES.indexOf(b.branch));
    });
    var clip = function (x, n) {
      if (x.length <= n) return x;
      var cut = x.slice(0, n), sp = cut.lastIndexOf(' ');
      return (sp > n - 15 ? cut.slice(0, sp) : cut) + '…';   // ภาษาไทยไม่เว้นวรรค ตัดตรงความยาวได้เลย
    };
    var body = list.map(function (r, k) {
      var s = ST[r.st];
      var line2 = noScore(r)
        ? (r.st === 'pending' ? 'ยังไม่ส่ง Checklist วันนี้' + (r.sheetDate ? ' · ข้อมูลล่าสุด ' + r.sheetDate : '') : 'ไม่พบแท็บในชีต')
        : 'ผู้ตรวจ ' + (r.inspector || '-');
      var extra = '';
      if (r.fails.length) {
        extra += '<div style="margin-top:8px;background:#FDF2F2;border-radius:8px;padding:8px 12px;font-size:14px;line-height:21px;color:#1D1D1F;">' +
          '<b style="color:' + RED + ';">ไม่ผ่าน:</b> ' + r.fails.map(function (f) {
            return esc_(clip(f.item, 120)) + (f.detail ? '<br><span style="font-size:13px;color:#8A4B00;">' + esc_(f.detail) + '</span>' : '');
          }).join('<br>') + '</div>';
      }
      if (!noScore(r) && r.notes.length) {
        var pts = splitNotes_(r.notes).points;
        if (pts.length) {
          extra += '<div style="margin-top:6px;font-size:14px;line-height:21px;color:#3A3A3C;">' +
            pts.slice(0, 2).map(function (p) { return '• ' + esc_(clip(p, 110)); }).join('<br>') +
            (pts.length > 2 ? '<br><span style="color:' + MUTED + ';font-size:13px;">และอีก ' + (pts.length - 2) + ' ข้อในชีต</span>' : '') + '</div>';
        }
      }
      return '<tr><td style="padding:14px 0;border-top:' + (k ? '1px solid ' + LINE : '0') + ';">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
          '<td width="14" valign="top" style="padding-top:7px;"><div style="width:8px;height:8px;border-radius:4px;background:' + s.c + ';font-size:0;line-height:0;">&nbsp;</div></td>' +
          '<td valign="top"><div style="font-size:16px;font-weight:700;color:' + INK + ';line-height:22px;">' + esc_(r.branch) + '</div>' +
            '<div style="font-size:13px;color:' + MUTED + ';line-height:19px;">' + esc_(line2) + '</div></td>' +
          '<td valign="top" align="right" style="white-space:nowrap;">' +
            '<div style="font-size:18px;font-weight:700;color:' + s.c + ';line-height:22px;">' + (noScore(r) ? '–' : r.score + '<span style="font-size:13px;color:' + MUTED + ';font-weight:600;">/' + FULL_SCORE + '</span>') + '</div>' +
            (r.missing ? '' : '<a href="' + base + r.gid + '" style="font-size:13px;color:' + RED + ';text-decoration:none;font-weight:600;">ดูชีต &rarr;</a>') + '</td>' +
        '</tr></table>' +
        (extra ? '<div style="padding-left:14px;">' + extra + '</div>' : '') +
        '</td></tr>';
    }).join('');

    var headline = !done.length ? 'ยังไม่มีสาขาใดส่ง Checklist'
      : full === rows.length ? 'ทุกสาขาได้คะแนนเต็ม'
      : 'คะแนนเต็ม ' + full + ' จาก ' + rows.length + ' สาขา';
    var sub = watch.length
      ? 'ต้องติดตาม ' + watch.map(function (r) { return r.branch; }).join(', ')
      : 'ไม่มีสาขาที่ต้องติดตาม';
return wrap(
      '<tr><td style="background:' + RED + ';background-image:linear-gradient(120deg,#C7000B,#E0242E);padding:20px 24px;">' +
        '<div style="font-size:13px;color:#FFE3E5;">Morning Store Checklist · ' + longDate + '</div>' +
        '<div style="font-size:24px;font-weight:700;color:#ffffff;line-height:32px;margin-top:6px;">' + headline + '</div>' +
        '<div style="font-size:15px;color:#ffffff;margin-top:2px;">' + esc_(sub) + '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:12px 24px;background:#FAFAFB;border-bottom:1px solid ' + LINE + ';font-size:14px;color:' + INK + ';">' +
        'ส่งแล้ว <b>' + done.length + '/' + rows.length + '</b> &nbsp;·&nbsp; เฉลี่ย <b>' + avg.toFixed(2) + '</b> &nbsp;·&nbsp; <span style="color:' + MUTED + ';">เกณฑ์ไม่ต่ำกว่า ' + MIN_SCORE + '/' + FULL_SCORE + '</span></td></tr>' +
      '<tr><td style="padding:4px 24px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + body + '</table></td></tr>'
    );
  }

  /* ---------- B: กระดานคะแนน — เห็นทุกสาขาในตาราง 3x3 รายละเอียดเฉพาะที่ต้องติดตาม ---------- */
  if (style === 'B') {
    var tiles = '';
    for (var i = 0; i < rows.length; i += 3) {
      tiles += '<tr>';
      for (var j = i; j < i + 3; j++) {
        var r = rows[j];
        if (!r) { tiles += '<td width="33%"></td>'; continue; }
        var s = ST[r.st];
        tiles += '<td width="33%" style="padding:4px;"><a href="' + (r.missing ? '#' : base + r.gid) + '" style="text-decoration:none;display:block;">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + s.bg + ';border-radius:12px;"><tr><td style="padding:12px 12px 11px;">' +
          '<div style="font-size:12px;font-weight:700;color:' + INK + ';letter-spacing:.3px;">' + esc_(r.branch) + '</div>' +
          '<div style="font-size:28px;line-height:34px;font-weight:700;color:' + s.c + ';margin-top:4px;">' + (noScore(r) ? '–' : r.score) +
          (noScore(r) ? '' : '<span style="font-size:13px;font-weight:600;color:' + MUTED + ';">/' + FULL_SCORE + '</span>') + '</div>' +
          '<div style="font-size:11px;font-weight:600;color:' + s.c + ';">' + s.label + '</div>' +
          '</td></tr></table></a></td>';
      }
      tiles += '</tr>';
    }

    var attention = watch.map(function (r) {
      var s = ST[r.st];
      return '<tr><td style="padding:0 24px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + LINE + ';border-radius:12px;border-collapse:separate;"><tr><td style="padding:14px 16px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:15px;font-weight:700;color:' + INK + ';">' + esc_(r.branch) +
        ' <span style="font-size:13px;font-weight:400;color:' + MUTED + ';">· ' + esc_(noScore(r) ? s.label : 'ผู้ตรวจ ' + (r.inspector || '-')) + '</span></td>' +
        '<td align="right" style="font-size:15px;font-weight:700;color:' + s.c + ';white-space:nowrap;">' + (noScore(r) ? '' : r.score + '/' + FULL_SCORE) + '</td></tr></table>' +
        (r.st === 'pending' ? '<div style="font-size:13px;color:' + MUTED + ';margin-top:6px;">ยังไม่อัปเดต Checklist ของวันนี้' + (r.sheetDate ? ' (ข้อมูลล่าสุด ' + r.sheetDate + ')' : '') + '</div>' : '') +
        (r.fails.length ? '<div style="font-size:12px;font-weight:700;color:' + RED + ';margin-top:10px;">ไม่ผ่าน ' + r.fails.length + ' ข้อ</div>' + failsHtml(r) : '') +
        '<div style="font-size:13px;margin-top:10px;">' + link(r) + '</div>' +
        '</td></tr></table></td></tr>';
    }).join('');
var notes = rows.filter(function (r) { return r.notes.length && !noScore(r); }).map(function (r, k) {
      return '<tr><td style="padding:12px 0;border-top:' + (k ? '1px solid ' + LINE : '0') + ';">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td width="84" valign="top" style="font-size:13px;font-weight:700;color:' + INK + ';padding-top:1px;">' + esc_(r.branch) + '</td>' +
        '<td valign="top" style="font-size:13px;color:#48484A;line-height:1.65;">' + notesHtml(r) +
        '<div style="font-size:12px;margin-top:4px;">' + link(r, 'เปิด Checklist', MUTED) + '</div></td></tr></table></td></tr>';
    }).join('');

    return wrap(
      '<tr><td style="height:5px;line-height:5px;font-size:0;background:' + RED + ';">&nbsp;</td></tr>' +
      '<tr><td style="padding:22px 24px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td valign="top"><div style="font-size:12px;font-weight:700;color:' + RED + ';letter-spacing:1px;">HUAWEI HUB BY UFICON</div>' +
        '<div style="font-size:22px;font-weight:700;color:' + INK + ';margin-top:4px;line-height:28px;">Morning Store Checklist</div>' +
        '<div style="font-size:13px;color:' + MUTED + ';margin-top:2px;">' + longDate + '</div></td>' +
        '<td valign="top" align="right" width="120"><div style="font-size:12px;color:' + MUTED + ';">คะแนนเฉลี่ย</div>' +
        '<div style="font-size:34px;line-height:40px;font-weight:700;color:' + (avg < MIN_SCORE && done.length ? RED : INK) + ';">' + avg.toFixed(2) + '</div></td>' +
      '</tr></table></td></tr>' +
      '<tr><td style="padding:4px 24px 14px;font-size:13px;color:' + INK + ';">ส่งแล้ว <b>' + done.length + '</b> จาก ' + rows.length + ' สาขา · ได้คะแนนเต็ม <b style="color:#1B7F3B;">' + full + '</b> สาขา' +
        (watch.length ? ' · ต้องติดตาม <b style="color:' + RED + ';">' + watch.length + '</b> สาขา' : '') +
        ' <span style="color:' + MUTED + ';">(เกณฑ์ไม่ต่ำกว่า ' + MIN_SCORE + '/' + FULL_SCORE + ')</span></td></tr>' +
      '<tr><td style="padding:0 20px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + tiles + '</table></td></tr>' +
      (watch.length
        ? '<tr><td style="padding:18px 24px 10px;font-size:13px;font-weight:700;color:' + RED + ';">ต้องติดตามวันนี้</td></tr>' + attention
        : '<tr><td style="padding:14px 24px 4px;font-size:13px;font-weight:600;color:#1B7F3B;">ทุกสาขาได้คะแนนเต็มวันนี้</td></tr>') +
      (notes ? '<tr><td style="padding:18px 24px 2px;font-size:13px;font-weight:700;color:' + INK + ';">หมายเหตุจากสาขา</td></tr>' +
        '<tr><td style="padding:0 24px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + notes + '</table></td></tr>' : '')
    );
  }

  /* ---------- C: สรุปผู้บริหาร — หัวเข้ม พาดหัวเป็นประโยค เรียงสาขาที่ต้องดูขึ้นก่อน ---------- */
  var order = { missing: 0, pending: 1, low: 2, pass: 3, full: 4 };
  var sorted = rows.slice().sort(function (a, b) {
    return (order[a.st] - order[b.st]) || ((a.score || 0) - (b.score || 0)) || (REPORT_BRANCHES.indexOf(a.branch) - REPORT_BRANCHES.indexOf(b.branch));
  });
  var headline = !done.length ? 'ยังไม่มีสาขาใดส่ง Checklist วันนี้'
    : full === rows.length ? 'ทุกสาขาได้คะแนนเต็มวันนี้'
    : full + ' จาก ' + rows.length + ' สาขาได้คะแนนเต็มวันนี้';
  var sub = watch.length ? 'ต้องติดตาม: ' + watch.map(function (r) { return r.branch; }).join(', ') : 'ไม่มีสาขาที่ต้องติดตาม';
var list = sorted.map(function (r, k) {
    var s = ST[r.st];
    var head = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td width="12" valign="top" style="padding-top:6px;"><div style="width:8px;height:8px;border-radius:4px;background:' + s.c + ';font-size:0;line-height:0;">&nbsp;</div></td>' +
      '<td valign="top"><span style="font-size:15px;font-weight:700;color:' + INK + ';">' + esc_(r.branch) + '</span>' +
      ' <span style="font-size:13px;color:' + MUTED + ';">' + esc_(noScore(r) ? s.label : r.inspector || '-') + '</span></td>' +
      '<td valign="top" align="right" style="white-space:nowrap;font-size:13px;font-weight:600;color:' + s.c + ';">' +
        (noScore(r) ? '' : '<span style="font-size:17px;font-weight:700;">' + r.score + '</span>/' + FULL_SCORE + ' · ') + s.label + '</td></tr></table>';
    var body = '';
    if (r.st === 'pending') body += '<div style="font-size:13px;color:' + MUTED + ';margin-top:4px;">ยังไม่อัปเดต Checklist ของวันนี้' + (r.sheetDate ? ' (ข้อมูลล่าสุด ' + r.sheetDate + ')' : '') + '</div>';
    if (r.fails.length) body += '<div style="margin-top:8px;padding:8px 12px;border-left:3px solid ' + RED + ';background:#FDF4F4;">' +
      '<div style="font-size:12px;font-weight:700;color:' + RED + ';">ไม่ผ่าน ' + r.fails.length + ' ข้อ</div>' + failsHtml(r) + '</div>';
    if (r.notes.length && !noScore(r)) body += '<div style="margin-top:8px;padding-left:12px;border-left:3px solid ' + LINE + ';font-size:13px;color:#48484A;line-height:1.65;">' + notesHtml(r) + '</div>';
    body += '<div style="font-size:12px;margin-top:8px;">' + link(r, 'เปิด Checklist ของสาขา &rarr;') + '</div>';
    return '<tr><td style="padding:16px 24px;border-top:' + (k ? '1px solid ' + LINE : '0') + ';"><div style="padding-left:0;">' + head +
      '<div style="padding-left:12px;">' + body + '</div></div></td></tr>';
  }).join('');

  return wrap(
    '<tr><td style="background:#1D1D1F;padding:22px 24px 20px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td><div style="font-size:12px;font-weight:600;color:#A1A1A6;letter-spacing:1px;">MORNING STORE CHECKLIST · ' + longDate + '</div>' +
      '<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:8px;line-height:30px;">' + headline + '</div>' +
      '<div style="font-size:13px;color:' + (watch.length ? '#FF8A8F' : '#8FD3A6') + ';margin-top:4px;">' + esc_(sub) + '</div></td>' +
      '</tr></table></td></tr>' +
    '<tr><td style="height:4px;line-height:4px;font-size:0;background:' + RED + ';">&nbsp;</td></tr>' +
    '<tr><td style="padding:0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ' + LINE + ';"><tr>' +
      ['ส่งแล้ว|' + done.length + '/' + rows.length + '|' + INK, 'คะแนนเต็ม|' + full + '|#1B7F3B', 'ต้องติดตาม|' + watch.length + '|' + (watch.length ? RED : INK), 'เฉลี่ย|' + avg.toFixed(2) + '|' + INK]
        .map(function (x, k) { x = x.split('|');
          return '<td width="25%" style="padding:14px 0 14px ' + (k ? '14px' : '0') + ';' + (k ? 'border-left:1px solid ' + LINE + ';' : '') + '">' +
            '<div style="font-size:12px;color:' + MUTED + ';">' + x[0] + '</div><div style="font-size:22px;font-weight:700;color:' + x[2] + ';line-height:28px;">' + x[1] + '</div></td>'; }).join('') +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:10px 24px 0;font-size:12px;color:' + MUTED + ';">เรียงสาขาที่ต้องติดตามขึ้นก่อน · เกณฑ์ไม่ต่ำกว่า ' + MIN_SCORE + '/' + FULL_SCORE + '</td></tr>' +
    list
  );
}/* ===================== จัดหมายเหตุให้อ่านง่าย ===================== */
// แตกหมายเหตุที่พิมพ์ต่อกันยาวๆ ด้วย " / " หรือขึ้นบรรทัดใหม่ ออกเป็นข้อๆ
// และแยกเรื่องกะพนักงาน (เวลาเข้างาน, หยุด, All Day) ไปไว้บรรทัด "กะวันนี้"
var SHIFT_RE = /(\d{1,2}\s*[:.]\s*\d{2}|all\s*day|day\s*off|off\s*day|หยุด|พักร้อน|ลาป่วย|ลากิจ|อบรม|เทรน|เข้า(เช้า|บ่าย|เที่ยง|งาน)|\b(AM|PM)\b)/i;
function splitNotes_(notes) {
  var points = [], shifts = [];
  notes.join('\n').replace(/\s+\/\s*(week|wk|day|month|วัน|เดือน)\b/gi, '/$1')  // "Target /week" ไม่ใช่ตัวคั่น
    .split(/\s*\/\s+|\s+\/\s*|\n+/).forEach(function (seg) {
    seg = seg.replace(/\s+/g, ' ').replace(/^[\s\-•*]+|[\s,]+$/g, '').trim();
    if (!seg) return;
    if (seg.length <= 45 && SHIFT_RE.test(seg) && !/(ยอด|target|เป้า|บาท)/i.test(seg)) shifts.push(seg);
    else points.push(seg);
  });
  return { points: points, shifts: shifts };
}
function notesBlock_(notes) {
  var n = splitNotes_(notes), html = '';
  if (n.points.length) {
    html += '<div style="font-size:12px;font-weight:700;color:#6E6E73;letter-spacing:.3px;margin-bottom:4px;">หมายเหตุจากสาขา</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      n.points.map(function (p) {
        return '<tr><td width="14" valign="top" style="font-size:14px;line-height:22px;color:#C7000B;">&bull;</td>' +
          '<td valign="top" style="font-size:14px;line-height:22px;color:#1D1D1F;padding-bottom:4px;">' + esc_(p) + '</td></tr>';
      }).join('') + '</table>';
  }
  if (n.shifts.length) {
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td style="background:#F5F5F7;border-radius:8px;padding:8px 12px;font-size:13px;line-height:20px;color:#3A3A3C;">' +
      '<b style="color:#1D1D1F;">กะวันนี้</b>&nbsp;&nbsp;' + n.shifts.map(esc_).join(' <span style="color:#C7C7CC;">|</span> ') + '</td></tr></table>';
  }
  return html;
}
