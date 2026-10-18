// ============================================================
// API client — talks to the Apps Script web app (Api.gs)
// ============================================================
(function () {
  const TIMEOUT_MS = 90000; // PDF generation can take a while

  async function call(action, payload, token) {
    const url = LWH_CONFIG.API_URL;
    if (!url || url.indexOf('PASTE_') === 0) {
      throw new Error('App is not connected yet. Set API_URL in js/config.js.');
    }
    if (!navigator.onLine) throw new Error('You are offline. Check your connection and try again.');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        // text/plain = "simple" request, so no CORS preflight to Apps Script
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: token || '', payload: payload || {} }),
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'The server took too long to respond. Please try again.' : 'Connection error. Please try again.');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('Server error (' + res.status + '). Please try again.');

    let data;
    try { data = await res.json(); }
    catch (e) { throw new Error('Unexpected server response. Check the Apps Script deployment.'); }

    if (data && data.authExpired && typeof window.onAuthExpired === 'function') {
      window.onAuthExpired(token);
    }
    return data;
  }

  window.API = { call: call };
})();
