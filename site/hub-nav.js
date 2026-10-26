/* HUAWEI Hub — bottom navigation (Antt, 20 Oct 2026): หน้าแรก · เครื่องมือ · แดชบอร์ด · ตั้งค่า
   Every hub page loads it with <script src="/hub-nav.js">.
   - เครื่องมือ: sheet with the same apps as the portal menu (/api/hub/apps, filtered by this account's
     menus) — apps added / removed on the ⚙️ admin page show up here by themselves.
   - ตั้งค่า: account, branch, recorder, change branch, sign out, "จัดการพอร์ทัล" (/admin, owner only).
   - Sets the CSS variable --hub-dock (space taken by the bar) so a page's own bottom bar can sit above it.
   - window.HUB_SWITCH() / window.HUB_LOGOUT() for pages (e.g. ST Report). */
(function () {
  if (window.__hubNav) return;
  window.__hubNav = true;

  var BRANCH_ALL = '*';
  var TOKEN_KEY = 'hub-dashboard-idtoken';
  var ICON = {
    checklist: ['M9 3h6v3H9z', 'M7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1', 'm9 13.5 2 2 4-4.5'],
    tool: ['M14.7 6.3a4 4 0 0 0-5.4 5.3l-5.8 5.8a1.5 1.5 0 0 0 2.1 2.1l5.8-5.8a4 4 0 0 0 5.3-5.4l-2.5 2.5-2-.5-.5-2z'],
    chart: ['M4 20h16', 'M7 16v-5', 'M12 16V7', 'M17 16v-8'],
    moon: ['M20 14.5A8 8 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5z'],
    box: ['M21 8 12 3 3 8v8l9 5 9-5z', 'm3 8 9 5 9-5', 'M12 13v8'],
    receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
    calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 10h18', 'M8 3v4', 'M16 3v4'],
    users: ['M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M3 20a6 6 0 0 1 12 0', 'M16 4.5a3.5 3.5 0 0 1 0 7', 'M21 20a6 6 0 0 0-4-5.6'],
    phone: ['M9 2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'],
    megaphone: ['M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z', 'M17 9a3 3 0 0 1 0 6'],
    file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
    link: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    // bar + settings
    home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5'],
    grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
    gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
    swap: ['M7 4 3 8l4 4', 'M3 8h14', 'm17 20 4-4-4-4', 'M21 16H7'],
    logout: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 17l-5-5 5-5', 'M5 12h11'],
    sliders: ['M4 6h10', 'M18 6h2', 'M16 4v4', 'M4 12h4', 'M12 12h8', 'M10 10v4', 'M4 18h12', 'M20 18h0', 'M18 16v4'],
  };
  var EMOJI = { '📋': 'checklist', '🛠️': 'tool', '🛠': 'tool', '🔧': 'tool', '📊': 'chart', '📈': 'chart', '🌙': 'moon', '📦': 'box', '🧾': 'receipt', '📅': 'calendar', '👥': 'users', '📱': 'phone', '📣': 'megaphone', '📄': 'file', '🔗': 'link' };
  function svg(k) {
    var d = ICON[k] || ICON[EMOJI[k]] || ICON.file;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      d.map(function (p) { return '<path d="' + p + '"/>'; }).join('') + '</svg>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }

  var DEFAULT_APPS = [
    { icon: 'checklist', name: 'Morning Store Checklist', desc: 'ตรวจความพร้อมก่อนเปิดร้าน ทำทุกเช้า', url: '/checklist' },
    { icon: 'tool', name: 'Service Case', desc: 'บันทึกเคสที่ช่วยลูกค้า ทั้งสำเร็จและไม่สำเร็จ', url: '/case-log' },
    { icon: 'file', name: 'ST Report', desc: 'กด + ทุกครั้งที่ขายได้ ส่งรายงานรอบ 15:00 และปิดร้าน', url: '/st-report' },
    { icon: 'users', name: 'Foot Traffic', desc: 'นับคนเดินเข้าร้าน / เดินผ่านหน้าร้าน กด +1 ทุกครั้ง ดูยอดรายชั่วโมง', url: '/foot-traffic' },
    { icon: 'chart', name: 'Checklist Report Dashboard', desc: 'สรุปคะแนน Checklist ทุกสาขา (เฉพาะผู้มีสิทธิ์)', url: '/report-dashboard' },
  ];
  var apps = get('hub_apps', null) || DEFAULT_APPS;
  function user() { var u = get('hub_user', null); return u && u.email ? u : null; }
  function canSee(u, a) { return !!u && (u.isOwner || (Array.isArray(u.menus) && u.menus.indexOf(a.url) !== -1)); }
  function branch() { var b = get('hub_branch', null); return b === BRANCH_ALL ? 'ทุกสาขา' : b || 'ยังไม่เลือกสาขา'; }
  // ผู้บันทึกล่าสุดของเครื่องนี้ (Service Case / ST Report ใช้ชุดเดียวกัน, Checklist เก็บแยก)
  function recorder() {
    var s = get('hcl_settings', {}) || {};
    if (s.staff) return s.staff;
    try { return localStorage.getItem('checklist-inspector') || ''; } catch (e) { return ''; }
  }

  // Same look on every page: the bar and sheets use the portal font and sizes, whatever the page uses
  // (Service Case is in TH Sarabun New, smaller — Antt, 20 Oct 2026).
  if (!document.querySelector('link[href*="IBM+Plex+Sans+Thai"]')) {
    var fl = document.createElement('link');
    fl.rel = 'stylesheet';
    fl.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap';
    document.head.appendChild(fl);
  }
  var FONT = "'IBM Plex Sans Thai',-apple-system,'Leelawadee UI','Noto Sans Thai',sans-serif";
  var css = '' +
    '.hubnav,.hubnav *,.hubsheet,.hubsheet *{font-family:' + FONT + ';letter-spacing:normal;-webkit-text-size-adjust:100%;text-size-adjust:100%;box-sizing:border-box}' +
    '.hubsheet{font-size:15px;line-height:1.4;color:#1D1D1F}' +
    '.hubnav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));z-index:45;display:grid;grid-template-columns:repeat(4,1fr);gap:2px;' +
    'width:min(calc(100% - 24px),460px);background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid #E6E6EB;border-radius:26px;padding:6px;box-shadow:0 10px 30px rgba(0,0,0,.12);line-height:1.2}' +
    '.hubnav[hidden]{display:none}' +
    '.hubnav a,.hubnav button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:54px;border:0;background:none;border-radius:20px;color:#3A3A3F;font-size:12px;font-weight:500;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '.hubnav svg{width:23px;height:23px}' +
    '.hubnav .on{background:#FDE7E8;color:#C7000B;font-weight:700}' +
    'body{padding-bottom:var(--hub-dock,0px)}' +
    '.hubsheet{position:fixed;inset:0;z-index:70;background:rgba(20,20,22,.38);display:flex;align-items:flex-end;justify-content:center}' +
    '.hubsheet[hidden]{display:none}' +
    '.hubsheet .pane{width:100%;max-width:560px;max-height:82vh;overflow:auto;background:#F5F5F7;border-radius:26px 26px 0 0;padding:10px 16px calc(22px + env(safe-area-inset-bottom));animation:hubUp .22s ease-out}' +
    '@keyframes hubUp{from{transform:translateY(40px);opacity:.6}to{transform:none;opacity:1}}' +
    '.hubsheet .grab{width:42px;height:5px;border-radius:3px;background:#D1D1D6;margin:0 auto 14px}' +
    '.hubsheet h3{font-size:21px;font-weight:700;margin:0 4px 12px;color:#1D1D1F}' +
    '.hubsheet .lab{font-size:13px;color:#6E6E73;margin:0 6px 6px}' +
    '.hubsheet .list{background:#fff;border:1px solid #E6E6EB;border-radius:20px;overflow:hidden}' +
    '.hubsheet .row{display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border:0;background:none;text-align:left;color:#1D1D1F;text-decoration:none;font-size:15px;cursor:pointer}' +
    '.hubsheet .row+.row{border-top:1px solid #EDEDF0}' +
    '.hubsheet .row .ic{flex:0 0 40px;height:40px;border-radius:12px;background:#FDECEC;color:#C7000B;display:flex;align-items:center;justify-content:center}' +
    '.hubsheet .row .ic svg{width:21px;height:21px}' +
    '.hubsheet .row .tx{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.35}' +
    '.hubsheet .row .tx b{font-size:15.5px;font-weight:700;overflow-wrap:anywhere}' +
    '.hubsheet .row .tx small{font-size:12.5px;color:#6E6E73;margin-top:1px}' +
    '.hubsheet .row .chev{color:#B0B0B6;font-size:22px;line-height:1}' +
    '.hubsheet .row.red,.hubsheet .row.red .tx b{color:#C7000B}' +
    '.hubsheet .row.static{cursor:default}' +
    '.hubsheet .empty{padding:18px;color:#6E6E73;font-size:14px;text-align:center}' +
    '.hubsheet .gap{height:14px}' +
    // the portal's account chip moved into the settings sheet
    '.hubnav-on #acct{display:none}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var path = location.pathname.replace(/\/+$/, '').replace(/\.html$/, '') || '/';
  var tab = path === '/' || path === '/index' ? 'home' : path === '/report-dashboard' || path === '/records' ? 'dash' : 'tools';

  var nav = document.createElement('nav');
  nav.className = 'hubnav';
  nav.setAttribute('aria-label', 'เมนูหลัก');
  nav.hidden = true;
  nav.innerHTML =
    '<a href="/" data-t="home">' + svg('home') + 'หน้าแรก</a>' +
    '<button type="button" data-t="tools">' + svg('grid') + 'เครื่องมือ</button>' +
    '<button type="button" data-t="dash">' + svg('chart') + 'แดชบอร์ด</button>' +
    '<button type="button" data-t="set">' + svg('gear') + 'ตั้งค่า</button>';
  var sheet = document.createElement('div');
  sheet.className = 'hubsheet';
  sheet.hidden = true;
  sheet.innerHTML = '<div class="pane" role="dialog" aria-modal="true"><div class="grab"></div><div id="hubSheetBody"></div></div>';

  function mark(t) { [].forEach.call(nav.querySelectorAll('[data-t]'), function (el) { el.classList.toggle('on', el.dataset.t === t); }); }
  function open(html, t) { document.getElementById('hubSheetBody').innerHTML = html; sheet.hidden = false; mark(t); }
  function close() { sheet.hidden = true; mark(tab); }

  // Report apps (moment "รายงาน": Checklist Report Dashboard, รายงานสาขา, …) live under แดชบอร์ด, not here (Antt, 20 Oct 2026).
  function isReport(a) { return a.moment === 'รายงาน' || a.url === '/report-dashboard' || a.url === '/records'; }
  function toolsHtml() {
    var u = user(), list = apps.filter(function (a) { return canSee(u, a) && !isReport(a); });
    return '<h3>เครื่องมือ</h3><div class="list">' + (list.length ? list.map(function (a) {
      var ext = /^https?:/.test(a.url);
      return '<a class="row" href="' + esc(a.url) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '><span class="ic">' + svg(a.icon) + '</span>' +
        '<span class="tx"><b>' + esc(a.name) + '</b>' + (a.desc ? '<small>' + esc(a.desc) + '</small>' : '') + '</span><span class="chev">›</span></a>';
    }).join('') : '<div class="empty">บัญชีนี้ยังไม่มีเมนูที่ใช้งานได้ — ติดต่อผู้ดูแลระบบ</div>') + '</div>';
  }
  // แดชบอร์ด: choose which topic (Antt, 20 Oct 2026) — Checklist scores, Service Case, ST Report.
  // Checklist = the Report Dashboard app (per-email menus); Service Case / ST Report = /records (owner / Dashboard accounts).
  function dashHtml() {
    var u = user() || {}, admin = !!(u.isOwner || u.canDashboard), list = [];
    if (canSee(u, { url: '/report-dashboard' })) list.push({ icon: 'checklist', name: 'Morning Store Checklist', desc: 'สรุปคะแนน Checklist ทุกสาขา รายวัน / สัปดาห์ / เดือน', url: '/report-dashboard' });
    if (admin) {
      list.push({ icon: 'tool', name: 'Service Case', desc: 'เคสที่ช่วยลูกค้า สำเร็จ / ไม่สำเร็จ เรื่องที่เจอบ่อย แยกสาขา', url: '/records?view=case' });
      list.push({ icon: 'receipt', name: 'ST Report', desc: 'ยอดขายแต่ละหมวด รุ่นขายดี รอบที่ส่งรายงาน แยกสาขา', url: '/records?view=st' });
      list.push({ icon: 'users', name: 'Foot Traffic', desc: 'คนเดินเข้าร้าน / เดินผ่าน รายชั่วโมง อัตราเข้าร้าน อัตราซื้อ แยกสาขา', url: '/records?view=foot' });
    }
    // other report apps added on ⚙️ (moment "รายงาน") show up here too
    apps.forEach(function (a) { if (isReport(a) && a.url !== '/report-dashboard' && a.url !== '/records' && canSee(u, a)) list.push(a); });
    var curView = path === '/records' ? (new URLSearchParams(location.search).get('view') || 'all') : '';
    return '<h3>แดชบอร์ด</h3><div class="lab">เลือกเรื่องที่ต้องการดู</div><div class="list">' + (list.length ? list.map(function (a) {
      var on = a.url === '/report-dashboard' ? path === '/report-dashboard' : a.url === '/records?view=' + curView;
      var ext = /^https?:/.test(a.url);
      return '<a class="row" href="' + esc(a.url) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '><span class="ic">' + svg(a.icon) + '</span><span class="tx"><b>' + esc(a.name) + (on ? ' <small style="display:inline;color:#C7000B;font-weight:600">· กำลังดู</small>' : '') + '</b><small>' + esc(a.desc) + '</small></span><span class="chev">›</span></a>';
    }).join('') : '<div class="empty">บัญชีนี้ยังไม่มีแดชบอร์ดที่ดูได้ — ติดต่อผู้ดูแลระบบ</div>') + '</div>';
  }
  function settingsHtml() {
    var u = user() || {}, rec = recorder();
    return '<h3>ตั้งค่า</h3><div class="lab">บัญชี</div><div class="list">' +
      '<div class="row static"><span class="ic">' + svg('user') + '</span><span class="tx"><b>' + esc(u.email || '-') + '</b>' +
      '<small>สาขา ' + esc(branch()) + (rec ? ' · ' + esc(rec) : '') + (u.isOwner ? ' · เจ้าของระบบ' : u.canDashboard ? ' · ผู้ดูแล' : '') + '</small></span></div>' +
      (u.branch
        ? '<div class="row static"><span class="ic">' + svg('swap') + '</span><span class="tx"><b>สาขา ' + esc(u.branch) + '</b><small>ล็อกตามอีเมลของสาขา (ทีม HOHW เท่านั้นที่เลือกสาขาได้)</small></span></div>'
        : '<button class="row" type="button" data-a="branch"><span class="ic">' + svg('swap') + '</span><span class="tx"><b>เปลี่ยนสาขา</b><small>เลือกสาขาของเครื่องนี้ใหม่</small></span><span class="chev">›</span></button>') +
      (u.isOwner || u.canDashboard ? '<a class="row" href="/records"><span class="ic">' + svg('chart') + '</span><span class="tx"><b>รายงานสาขา</b><small>สรุป Service Case · ST Report · Foot Traffic เป็นแดชบอร์ด + ดาวน์โหลด Excel</small></span><span class="chev">›</span></a>' : '') +
      (u.isOwner ? '<a class="row" href="/admin"><span class="ic">' + svg('sliders') + '</span><span class="tx"><b>จัดการพอร์ทัล</b><small>เมนู · รายชื่อทีม · สิทธิ์อีเมล (เฉพาะผู้ดูแล)</small></span><span class="chev">›</span></a>' : '') +
      '<button class="row red" type="button" data-a="out"><span class="ic">' + svg('logout') + '</span><span class="tx"><b>ออกจากระบบ</b></span><span class="chev">›</span></button>' +
      '</div>';
  }

  // Change branch: the portal page has the branch picker; elsewhere go there and come back.
  function switchBranch() {
    close();
    var u = user();
    if (u && u.branch) return;   // branch account: locked to its branch
    if (typeof window.openBranchChange === 'function') return window.openBranchChange();
    location.href = '/?switch=branch&next=' + encodeURIComponent(location.pathname + location.search);
  }
  function logout() {
    close();
    try { fetch('/api/hub/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }); } catch (e) {}
    if (typeof window.signOutHub === 'function') return window.signOutHub();
    try { localStorage.removeItem('hub_user'); localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    location.href = '/';
  }
  window.HUB_SWITCH = switchBranch;
  window.HUB_SETTINGS = function () { open(settingsHtml(), 'set'); };
  window.HUB_LOGOUT = logout;

  nav.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-t]');
    if (!b) return;
    if (b.dataset.t === 'tools') open(toolsHtml(), 'tools');
    else if (b.dataset.t === 'dash') open(dashHtml(), 'dash');
    else if (b.dataset.t === 'set') open(settingsHtml(), 'set');
  });
  sheet.addEventListener('click', function (e) {
    if (e.target === sheet) return close();
    var a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'branch') switchBranch();
    else if (a.dataset.a === 'out') logout();

  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) close(); });

  // Shown only to a signed-in account (and not over the portal's sign-in screen).
  function refresh() {
    var gate = tab === 'home' ? document.getElementById('gate') : null;   // the portal's sign-in screen
    var show = !!user() && !(gate && !gate.hidden);
    if (nav.hidden === !show) return;
    nav.hidden = !show;
    if (!show) close();
    document.documentElement.style.setProperty('--hub-dock', show ? (nav.offsetHeight + 16) + 'px' : '0px');
  }
  function mount() {
    document.documentElement.classList.add('hubnav-on');
    document.body.appendChild(nav);
    document.body.appendChild(sheet);
    mark(tab);
    refresh();
    if (typeof window.renderGear === 'function') window.renderGear();   // portal: the ⚙️ button now opens this sheet
    setInterval(refresh, 700);
    window.addEventListener('storage', refresh);
    fetch('/api/hub/apps', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && Array.isArray(d.apps) && d.apps.length) { apps = d.apps; try { localStorage.setItem('hub_apps', JSON.stringify(apps)); } catch (e) {} }
    }).catch(function () {});
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
