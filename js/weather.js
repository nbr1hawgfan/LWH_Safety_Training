// ============================================================
// Top strip: live clock + current temp + today's forecast
// Open-Meteo (free, no key). Last good reading is cached so the
// strip still shows something when the device is offline.
// ============================================================
(function () {
  const W = LWH_CONFIG.WEATHER;
  const TZ = W.timezone || 'America/Chicago';
  const CACHE_KEY = 'lwh_st_wx';

  const ICONS = {
    sun:   '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    part:  '<path d="M8 3v1.5M3.5 8H2M4.3 4.3l1 1M12 4.3l-1 1"/><path d="M5.5 10a3.5 3.5 0 0 1 6.3-2"/><path d="M8 20h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4 1.5A3.3 3.3 0 0 0 8 20z"/>',
    cloud: '<path d="M7 19h11a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 19z"/>',
    fog:   '<path d="M4 9h16M3 13h18M5 17h14"/>',
    rain:  '<path d="M7 15h11a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    snow:  '<path d="M7 14h11a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/>',
    storm: '<path d="M7 14h11a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 14z"/><path d="M12 15l-2 4h4l-2 4"/>',
  };

  function codeInfo(c) {
    if (c === 0) return ['Clear', 'sun'];
    if (c === 1) return ['Mostly Clear', 'sun'];
    if (c === 2) return ['Partly Cloudy', 'part'];
    if (c === 3) return ['Overcast', 'cloud'];
    if (c === 45 || c === 48) return ['Fog', 'fog'];
    if (c >= 51 && c <= 57) return ['Drizzle', 'rain'];
    if (c >= 61 && c <= 67) return ['Rain', 'rain'];
    if (c >= 71 && c <= 77) return ['Snow', 'snow'];
    if (c >= 80 && c <= 82) return ['Showers', 'rain'];
    if (c === 85 || c === 86) return ['Snow Showers', 'snow'];
    if (c >= 95) return ['Thunderstorms', 'storm'];
    return ['--', 'cloud'];
  }

  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  function $(id) { return document.getElementById(id); }

  function tickClock() {
    const now = new Date();
    $('utilClock').textContent = now.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    $('utilDate').textContent  = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function render(d) {
    if (!d) return;
    const now = codeInfo(d.code);
    const day = codeInfo(d.dayCode);
    $('wxIcon').innerHTML = svg(now[1]);
    $('wxTemp').textContent = Math.round(d.temp) + '°F';
    $('wxCond').textContent = now[0];
    $('wxHiLo').textContent = 'H ' + Math.round(d.hi) + '° / L ' + Math.round(d.lo) + '°';
    $('wxRain').textContent = (d.rain == null ? '--' : d.rain) + '% rain';
    $('wxNow').title   = W.label + ' — now: ' + now[0];
    $('wxToday').title = W.label + ' — today: ' + day[0] + (d.rain != null ? ', ' + d.rain + '% chance of rain' : '');
  }

  async function loadWeather() {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + W.lat + '&longitude=' + W.lon +
      '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&temperature_unit=fahrenheit&timezone=' + encodeURIComponent(TZ) + '&forecast_days=1';
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const d = {
        temp: j.current.temperature_2m, code: j.current.weather_code,
        hi: j.daily.temperature_2m_max[0], lo: j.daily.temperature_2m_min[0],
        dayCode: j.daily.weather_code[0], rain: j.daily.precipitation_probability_max[0],
        at: Date.now(),
      };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch (e) {}
      render(d);
    } catch (e) {
      try { render(JSON.parse(localStorage.getItem(CACHE_KEY))); } catch (x) {}
    }
  }

  tickClock();
  setInterval(tickClock, 1000);
  try { render(JSON.parse(localStorage.getItem(CACHE_KEY))); } catch (e) {}
  loadWeather();
  setInterval(loadWeather, (W.refreshMinutes || 15) * 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tickClock(); loadWeather(); } });
})();
