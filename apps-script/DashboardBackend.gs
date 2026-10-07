/**
 * Report Dashboard — Web App backend (v2, security-hardened by Neo 2026-10-07)
 * ---------------------------------------------------------------------------
 * Bind this script to the "Huawei_Report Morning Checklist" spreadsheet
 * Extensions > Apps Script > paste this file in.
 *
 * WHAT CHANGED vs. v1
 *   v1 trusted an `email=` URL parameter, so anyone who had the /exec link
 *   could type an allowed email and download every branch's scores. v2 only
 *   accepts the Google sign-in ID token the dashboard page receives from
 *   "Sign in with Google", verifies it with Google (signature/expiry via the
 *   tokeninfo endpoint), checks it was issued for OUR OAuth Client ID, that
 *   the email is verified, and that it's on ALLOWED_EMAILS.
 *
 * ONE-TIME SETUP
 *   1. Paste this file in (replace any starter code).
 *   2. Set GOOGLE_CLIENT_ID below to the same OAuth Client ID that is put into
 *      report-dashboard.html (SETUP step 3).
 *   3. Edit ALLOWED_EMAILS — everyone allowed to open the Report Dashboard.
 *   4. Deploy > New deployment > "Web app". Execute as: Me. Who has access: Anyone.
 *      Authorize (it will also ask for "connect to an external service" — that is
 *      the call to Google's token check).
 *   5. Copy the Web app URL (ends in /exec) → report-dashboard.html BACKEND_URL.
 *
 * Updating later: Deploy > Manage deployments > Edit (pencil) > New version >
 * Deploy (keeps the same URL).
 */

const SHEET_NAME = "ชีต1";

// Same value as GOOGLE_CLIENT_ID in report-dashboard.html (…apps.googleusercontent.com)
const GOOGLE_CLIENT_ID = "777160588326-vrashr368vl4461981rfhmue1dsjcdnf.apps.googleusercontent.com";

// Everyone allowed to view the Report Dashboard (Google account emails).
const ALLOWED_EMAILS = [
  "marketing.uficon@gmail.com",
  "benyapakamonphan@gmail.com",
  "th.verapat@gmail.com",
  "jomyutdamon1211@gmail.com",
  "qwe031168492@gmail.com"
  // "someone.else@uficon.com",
];

function doGet(e) {
  try {
    const auth = verifyIdToken_((e.parameter.idToken || '').trim());
    if (!auth.ok) return json({ ok: false, error: auth.error });

    const action = e.parameter.action || 'report';
    if (action === 'report') {
      return json({ ok: true, rows: getReportRows(), user: auth.email });
    }
    return json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/**
 * Verifies a Google Sign-In ID token. Google's tokeninfo endpoint checks the
 * signature and expiry; we then check audience, issuer, verified email and the
 * allow-list. Results are cached for 5 minutes per token to avoid repeat calls.
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
    return { ok: false, error: 'การเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' };
  }
  const info = JSON.parse(res.getContentText());
  const email = String(info.email || '').toLowerCase().trim();
  const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const verified = info.email_verified === true || info.email_verified === 'true';
  const notExpired = Number(info.exp || 0) * 1000 > Date.now();

  let result;
  if (info.aud !== GOOGLE_CLIENT_ID || !issuerOk || !notExpired) {
    result = { ok: false, error: 'การเข้าสู่ระบบไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' };
  } else if (!verified || !isAllowed(email)) {
    result = { ok: false, error: 'บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าถึง Dashboard นี้' };
  } else {
    result = { ok: true, email: email };
  }
  cache.put(cacheKey, JSON.stringify(result), 300);
  return result;
}

function isAllowed(email) {
  if (!email) return false;
  return ALLOWED_EMAILS.map(x => x.toLowerCase().trim()).indexOf(email) !== -1;
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
