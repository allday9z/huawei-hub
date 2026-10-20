/* HUAWEI Hub — pages that need a signed-in account load this first (<script src="/auth-guard.js">).
   The sign-in screen lives on the portal (/): not signed in on this device -> go there, then come back. */
(function () {
  try { var u = JSON.parse(localStorage.getItem('hub_user') || 'null'); if (u && u.email) return; } catch (e) {}
  location.replace('/?next=' + encodeURIComponent(location.pathname + location.search));
})();
