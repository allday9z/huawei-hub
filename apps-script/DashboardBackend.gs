/**
 * Report Dashboard (Morning Internal Dashboard) — Web App backend (v4, Neo 2026-10-20)
 * ---------------------------------------------------------------------------
 * Bind this script to the "Huawei_Report Morning Checklist" spreadsheet
 * Extensions > Apps Script > paste this file in (replace the whole file).
 *
 * v4 = Antt's v3 edits (MorningInternalDashboard.gs, 20 Oct 2026) merged with Neo's v3 (16 Oct):
 *   - [Antt] Error messages say the real reason (which email was rejected, Client ID
 *     mismatch, expired token, unverified email) instead of one generic message.
 *   - [Antt] Rejected results are NOT cached; only successful sign-ins are cached
 *     (5 min). Adding an email takes effect immediately.
 *   - [Antt] Email comparison ignores dots and "+tag" for gmail.com / googlemail.com
 *     (wetaga.chow@gmail.com == wetagachow@gmail.com), as Gmail itself does.
 *   - [Neo] WHO MAY VIEW is managed on the HUAWEI Hub ⚙️ page ("สิทธิ์อีเมล"): after the
 *     Google check, the token is forwarded to HUB_URL/api/admin/whoami, which verifies
 *     it again and answers canDashboard. ALLOWED_EMAILS below is only the fallback when
 *     the hub can't be reached — so the dashboard never locks everyone out.
 *   - [Neo] action=access ("may this account see the Dashboard?", no report data).
 *
 * ONE-TIME SETUP
 *   1. Paste this file in (replace any starter code).
 *   2. GOOGLE_CLIENT_ID must be the same OAuth Client ID that is in report-dashboard.html.
 *   3. People: add / remove them on the hub ⚙️ > สิทธิ์อีเมล (tick the Dashboard menu).
 *      Keep ALLOWED_EMAILS roughly in sync — it is only used if the hub is down.
 *   4. Deploy > New deployment > "Web app". Execute as: Me. Who has access: Anyone.
 *      Authorize (it also asks for "connect to an external service" — the calls to
 *      Google's token check and to the hub).
 *   5. Copy the Web app URL (ends in /exec) -> report-dashboard.html BACKEND_URL.
 *
 * Updating later: Deploy > Manage deployments > Edit (pencil) > New version >
 * Deploy (keeps the same URL). Editing the code alone does NOT update the live app.
 */

const SHEET_NAME = "ชีต1";

// Same value as GOOGLE_CLIENT_ID in report-dashboard.html (…apps.googleusercontent.com)
const GOOGLE_CLIENT_ID = "777160588326-vrashr368vl4461981rfhmue1dsjcdnf.apps.googleusercontent.com";

// HUAWEI Hub — manages who may view (⚙️ > สิทธิ์อีเมล). '' = use ALLOWED_EMAILS only.
const HUB_URL = "https://huawei-hub.coolify.pve01.prod.uficon.com";

// FALLBACK ONLY (used when the hub can't be reached). Manage people on the hub ⚙️ page.
const ALLOWED_EMAILS = [
  "wetaga.chow@gmail.com",       // เวธกา เชาวน์ชูเวชช (จ๊ะจ๋า) — HOHW
  "benyapakamonphan@gmail.com",
  "th.verapat@gmail.com",
  "jomyutdamon1211@gmail.com",
  "qwe031168492@gmail.com",
  "marketing.uficon@gmail.com"
];

function doGet(e) {
  try {
    const auth = verifyIdToken_((e.parameter.idToken || '').trim());
    if (!auth.ok) return json({ ok: false, error: auth.error });

    const action = e.parameter.action || 'report';
    if (action === 'report') {
      return json({ ok: true, rows: getReportRows(), user: auth.email });
    }
    // Hub home page: "may this account see the Dashboard menu?" — no report data.
    if (action === 'access') {
      return json({ ok: true, user: auth.email });
    }
    return json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/**
 * Verifies a Google Sign-In ID token. Google's tokeninfo endpoint checks the
 * signature and expiry; we then check audience, issuer, verified email and the
 * access list (hub, or ALLOWED_EMAILS as fallback). Only successful results are
 * cached (5 minutes per token).
 */
function verifyIdToken_(idToken) {
  if (!GOOGLE_CLIENT_ID) return { ok: false, error: 'ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID ในสคริปต์' };
  if (!idToken) return { ok: false, error: 'กรุณาเข้าสู่ระบบด้วยบัญชี Google' };

  const cache = CacheService.getScriptCache();
  const cacheKey = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    return { ok: false, error: 'การเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง (Google ตอบ ' + res.getResponseCode() + ') กรุณาเข้าสู่ระบบใหม่' };
  }
  const info = JSON.parse(res.getContentText());
  const email = String(info.email || '').toLowerCase().trim();
  const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const verified = info.email_verified === true || info.email_verified === 'true';
  const notExpired = Number(info.exp || 0) * 1000 > Date.now();

  if (info.aud !== GOOGLE_CLIENT_ID) {
    return { ok: false, error: 'Client ID ไม่ตรงกัน: ตรวจ GOOGLE_CLIENT_ID ในสคริปต์ให้ตรงกับในหน้า report-dashboard.html' };
  }
  if (!issuerOk || !notExpired) {
    return { ok: false, error: 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!verified) {
    return { ok: false, error: 'อีเมล ' + email + ' ยังไม่ได้รับการยืนยันจาก Google' };
  }
  const access = canView_(idToken, email);
  if (!access.ok) {
    return { ok: false, error: 'บัญชี ' + email + ' ยังไม่ได้รับสิทธิ์เข้าถึง Dashboard นี้' +
      (access.source === 'hub' ? ' (ผู้ดูแลเพิ่มสิทธิ์ได้ที่ HUAWEI Hub ⚙️ > สิทธิ์อีเมล — เลือกเมนู Dashboard)' : '') };
  }

  const result = { ok: true, email: email };
  cache.put(cacheKey, JSON.stringify(result), 300);
  return result;
}

// Ask the hub whether this signed-in account may view (list on the ⚙️ settings page).
// Falls back to ALLOWED_EMAILS if the hub is not set, down, or answers something unexpected.
function canView_(idToken, email) {
  if (HUB_URL) {
    try {
      const res = UrlFetchApp.fetch(HUB_URL + '/api/admin/whoami', {
        headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) {
        const r = JSON.parse(res.getContentText());
        if (r && r.ok && canonEmail_(r.email) === canonEmail_(email)) return { ok: r.canDashboard === true, source: 'hub' };
      }
    } catch (err) {}
  }
  return { ok: isAllowed(email), source: 'list' };
}

// Gmail ignores dots and anything after "+" (wetaga.chow+x@gmail.com = wetagachow@gmail.com).
function canonEmail_(email) {
  const e = String(email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  let user = e.slice(0, at), domain = e.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    user = user.split('+')[0].replace(/\./g, '');
    domain = 'gmail.com';
  }
  return user + '@' + domain;
}

function isAllowed(email) {
  if (!email) return false;
  const target = canonEmail_(email);
  return ALLOWED_EMAILS.some(function (x) { return canonEmail_(x) === target; });
}

/**
 * Reads the whole "ชีต1" table and returns it as structured rows:
 * [{ month, date, isAverage, branches: { "HMD-CWN": {score, reason}, ... } }, ...]
 * Branch columns are discovered from the header row (2 columns per branch:
 * score, reason), so adding/removing/reordering branches needs no code change.
 */
function getReportRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบชีต: ' + SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return [];

  const tz = Session.getScriptTimeZone();
  const header = values[0];
  const branchCols = [];
  for (let c = 2; c < header.length - 1; c += 2) {
    const name = String(header[c] || '').trim();
    if (!name || /^avr/i.test(name)) break;
    branchCols.push({ name, scoreCol: c, reasonCol: c + 1 });
  }

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const month = row[0];
    const date = row[1];
    if (!month && !date) continue; // blank separator row

    const isAverage = String(date).trim().toLowerCase() === 'avr';
    const branches = {};
    branchCols.forEach(b => {
      const score = row[b.scoreCol];
      const reason = row[b.reasonCol];
      if (score === '' && !reason) return;
      branches[b.name] = { score: score, reason: reason || '' };
    });
    if (Object.keys(branches).length === 0) continue;

    rows.push({
      // Date-typed cells would otherwise stringify as "Wed Oct 07 2026 …".
      month: month instanceof Date ? Utilities.formatDate(month, tz, 'MM/yyyy') : String(month || ''),
      date: date instanceof Date ? Utilities.formatDate(date, tz, 'd') : String(date || ''),
      isAverage: isAverage,
      branches: branches
    });
  }
  return rows;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
