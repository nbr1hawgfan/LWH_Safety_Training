// ============================================================
// LWH Safety Training — core app + employee training flow
// ============================================================
(function () {
  'use strict';

  // ── STATE ────────────────────────────────────────────────
  const APP = window.APP = {
    lang: 'EN',
    emp: null, empToken: '',
    mgrToken: '', mgrRole: '',
    employees: [],
    tab: 'emp', pendingTab: null,
    home: null,          // { months, specials }
    cur: null,           // { kind:'m'|'s', id, data }
    timer: null, timerLeft: 0, timerTotal: 0, timerRunning: false,
    lastActivity: Date.now(),
  };

  // ── UTILITIES ────────────────────────────────────────────
  const $ = window.$ = function (id) { return document.getElementById(id); };
  const esc = window.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  window.show = function (el, on) { (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', on === false); };
  window.hide = function (el) { (typeof el === 'string' ? $(el) : el).classList.add('hidden'); };
  window.alertBox = function (el, type, msg) {
    el = typeof el === 'string' ? $(el) : el;
    el.className = 'alert alert-' + type; el.textContent = msg; el.classList.remove('hidden');
  };
  window.toast = function (msg, ms) {
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, ms || 3500);
  };
  window.fmtDate = function (v) {
    if (!v) return '';
    const s = String(v);
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return s;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[2] + '/' + m[3] + '/' + m[1];
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('en-US', { timeZone: LWH_CONFIG.WEATHER.timezone, month: '2-digit', day: '2-digit', year: 'numeric' });
  };
  window.downloadBlob = function (blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };
  window.b64ToBlob = function (b64, type) {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type });
  };
  window.csvDownload = function (headers, rows, name) {
    const q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    const csv = [headers.map(q).join(',')].concat(rows.map(function (r) { return r.map(q).join(','); })).join('\r\n');
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), name);
  };
  function shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
    return b;
  }

  const ICO = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M5 12l5 5 9-10"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
    lock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M9 6l6 6-6 6"/></svg>',
  };
  window.ICO = ICO;

  // ── TABS + HEADER ────────────────────────────────────────
  window.showTab = function (tab) {
    APP.tab = tab;
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    let page = tab;
    if (tab !== 'emp' && !APP.mgrToken) { APP.pendingTab = tab; page = 'login'; }
    document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + page); });
    updateHeader();
    if (page === 'login') setTimeout(function () { $('mgrPin').focus(); }, 50);
    if (page !== 'emp' && page !== 'login' && window.Mgr) Mgr.onShow(tab);
    window.scrollTo(0, 0);
  };

  window.updateHeader = function () {
    let name = '', role = '', signedIn = false;
    if (APP.tab === 'emp' && APP.emp) {
      signedIn = true; name = APP.emp.firstName + ' ' + APP.emp.lastName; role = (APP.emp.warehouse || 'Employee') + ' · Signed In';
    } else if (APP.tab !== 'emp' && APP.mgrToken) {
      signedIn = true; name = APP.mgrRole === 'hr' ? 'Human Resources' : 'Manager'; role = 'Secure Session';
    }
    $('hdrUserName').textContent = name; $('hdrUserRole').textContent = role;
    show('hdrUser', signedIn); show('hdrSignOut', signedIn);
  };

  $('hdrSignOut').addEventListener('click', function () {
    if (APP.tab === 'emp') empLogout(); else if (window.Mgr) Mgr.logout();
  });

  document.querySelectorAll('.nav-btn').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });

  window.onAuthExpired = function (token) {
    if (token && token === APP.empToken) { empLogout(); alertBox('empLoginErr', 'warn', 'Your session expired. Please sign in again.'); }
    else if (token && token === APP.mgrToken && window.Mgr) { Mgr.logout(); alertBox('mgrLoginErr', 'warn', 'Your session expired. Please sign in again.'); }
  };

  // ── EMPLOYEE LIST ────────────────────────────────────────
  async function loadEmployees() {
    try {
      const r = await API.call('employees');
      if (!r.success) throw new Error(r.message || 'Could not load employees.');
      APP.employees = r.employees || [];
      const sel = $('empSel');
      sel.innerHTML = '<option value="">-- Select your name --</option>' + APP.employees.map(function (e) {
        return '<option value="' + esc(e.employeeId) + '">' + esc(e.displayName) + (e.warehouse ? ' (' + esc(e.warehouse) + ')' : '') + '</option>';
      }).join('');
      try { const last = localStorage.getItem('lwh_st_lastEmp'); if (last) sel.value = last; } catch (e) {}
      hide('empListLoading'); show('empLoginForm');
      if (window.Mgr) Mgr.fillEmployeeSelects();
    } catch (e) {
      $('empListLoading').innerHTML = '';
      alertBox('empLoginErr', 'error', e.message);
      const btn = document.createElement('button');
      btn.className = 'btn btn-black btn-sm mt'; btn.textContent = 'Try Again';
      btn.onclick = function () { hide('empLoginErr'); $('empListLoading').innerHTML = '<div class="spin"></div>Loading employee list...'; btn.remove(); loadEmployees(); };
      $('empListLoading').appendChild(btn);
    }
  }
  window.loadEmployees = loadEmployees;

  // ── EMPLOYEE LOGIN / LOGOUT ──────────────────────────────
  $('empLoginForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const id = $('empSel').value, pin = $('empPin').value.trim(), err = $('empLoginErr'), btn = $('empLoginBtn');
    hide(err);
    if (!id) return alertBox(err, 'error', 'Please select your name.');
    if (!/^\d{4}$/.test(pin)) return alertBox(err, 'error', 'PIN must be exactly 4 digits.');
    btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      const r = await API.call('login', { employeeId: id, pin: pin });
      if (!r.success) { $('empPin').value = ''; return alertBox(err, 'error', r.message || 'Sign in failed.'); }
      APP.emp = r; APP.empToken = r.token; APP.lang = r.language || 'EN';
      try { localStorage.setItem('lwh_st_lastEmp', id); } catch (e) {}
      saveEmpSession();
      $('empPin').value = '';
      showEmpHome();
    } catch (e) {
      alertBox(err, 'error', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  });

  function saveEmpSession() {
    try { sessionStorage.setItem('lwh_st_emp', JSON.stringify({ emp: APP.emp, token: APP.empToken, lang: APP.lang })); } catch (e) {}
  }

  window.empLogout = function () {
    if (APP.empToken) API.call('logout', {}, APP.empToken).catch(function () {});
    stopTimer();
    APP.emp = null; APP.empToken = ''; APP.cur = null; APP.home = null;
    try { sessionStorage.removeItem('lwh_st_emp'); } catch (e) {}
    $('vidFrame').src = 'about:blank';
    hide('emp-home'); hide('emp-training'); show('emp-login');
    hide('empLoginErr');
    updateHeader();
    window.scrollTo(0, 0);
  };

  // ── LANGUAGE ─────────────────────────────────────────────
  function applyLangUI() {
    document.querySelectorAll('.lang-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.lang === APP.lang); });
    const dir = APP.lang === 'AR' ? 'rtl' : 'ltr';
    $('emp-home').setAttribute('dir', dir);
    $('quizRoot').setAttribute('dir', dir);
    $('lblMonthly').textContent = t('monthly');
    $('lblSpecial').textContent = t('special');
    $('empWelcome').textContent = t('welcome', { name: APP.emp ? APP.emp.firstName : '' });
    $('empWelcomeSub').textContent = t('pick');
  }
  document.querySelectorAll('.lang-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      APP.lang = b.dataset.lang; saveEmpSession(); applyLangUI();
      if (APP.home) renderHome();
    });
  });

  // ── HOME (training list) ─────────────────────────────────
  function showEmpHome() {
    stopTimer();
    $('vidFrame').src = 'about:blank';
    hide('emp-login'); hide('emp-training'); show('emp-home');
    APP.cur = null;
    applyLangUI(); updateHeader();
    loadHome();
    window.scrollTo(0, 0);
  }
  window.showEmpHome = showEmpHome;

  async function loadHome() {
    show('empHomeSpin'); hide('empHomeBody');
    try {
      const res = await Promise.all([
        API.call('monthStatus', { lang: APP.lang }, APP.empToken),
        API.call('specialList', {}, APP.empToken),
      ]);
      if (!APP.empToken) return;
      if (!res[0].success) throw new Error(res[0].message || 'Could not load trainings.');
      APP.home = { months: res[0].months || [], specials: (res[1] && res[1].success) ? (res[1].trainings || []) : [] };
      renderHome();
    } catch (e) {
      $('monthList').innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>';
      hide('specialWrap');
    }
    hide('empHomeSpin'); show('empHomeBody');
  }

  function trowHtml(o) {
    return '<div class="trow ' + o.cls + '"' + (o.go ? ' role="button" tabindex="0" data-kind="' + o.kind + '" data-id="' + esc(o.id) + '"' : '') + '>' +
      '<div class="trow-ico ' + o.ico + '">' + o.icon + '</div>' +
      '<div class="trow-body">' +
        '<div class="trow-name">' + esc(o.name) + (o.tag ? '<span class="tag">' + esc(o.tag) + '</span>' : '') + '</div>' +
        '<div class="trow-topic">' + esc(o.topic) + '</div>' +
        (o.meta ? '<div class="trow-meta" style="color:' + o.metaColor + ';">' + esc(o.meta) + '</div>' : '') +
      '</div>' +
      (o.go ? '<div class="trow-arrow">' + ICO.arrow + '</div>' : '') +
    '</div>';
  }

  function renderHome() {
    const h = APP.home; if (!h) return;
    const ml = $('monthList');
    if (!h.months.length) {
      ml.innerHTML = '<div class="alert alert-info">' + esc(t('none')) + '</div>';
    } else {
      const anyMakeup = h.months.some(function (m) { return m.status === 'makeup' || m.status === 'makeup-blocked'; });
      ml.innerHTML = (anyMakeup ? '<div class="alert alert-warn">' + esc(t('priorNote')) + '</div>' : '') +
        h.months.slice().reverse().map(function (m) {
          const o = { kind: 'm', id: m.monthNum, name: m.monthName, topic: m.topic, tag: m.isCurrent ? t('thisMonth') : '' };
          if (m.status === 'complete') {
            Object.assign(o, { cls: 'done', ico: 'ico-done', icon: ICO.check, meta: t('completed', { date: m.completedAt }), metaColor: 'var(--green)' });
          } else if (m.status === 'locked') {
            Object.assign(o, { cls: 'locked', ico: 'ico-past', icon: ICO.lock, meta: t('locked'), metaColor: 'var(--red)' });
          } else if (m.canTake && m.isCurrent) {
            Object.assign(o, { go: true, cls: 'go current', ico: 'ico-todo', icon: ICO.play,
              meta: t('tapStart') + (m.isPastDeadline ? ' — ' + t('pastDue') : ''), metaColor: m.isPastDeadline ? 'var(--red)' : 'var(--black)' });
          } else if (m.canTake) {
            Object.assign(o, { go: true, cls: 'go current', ico: 'ico-past', icon: ICO.alert, meta: t('makeup'), metaColor: 'var(--red)' });
          } else {
            Object.assign(o, { cls: 'blocked', ico: 'ico-block', icon: ICO.block, meta: t('priorFirst'), metaColor: '#777' });
          }
          return trowHtml(o);
        }).join('');
    }

    if (h.specials.length) {
      $('specialList').innerHTML = h.specials.map(function (s) {
        const o = { kind: 's', id: s.trainingId, name: s.title, topic: t('specialOne') + (s.assignedBy ? ' · ' + s.assignedBy : '') };
        if (s.completed) {
          Object.assign(o, { cls: 'done', ico: 'ico-done', icon: ICO.check, meta: t('completed', { date: s.completedAt }), metaColor: 'var(--green)' });
        } else if (s.locked) {
          Object.assign(o, { cls: 'locked', ico: 'ico-past', icon: ICO.lock, meta: t('locked'), metaColor: 'var(--red)' });
        } else {
          Object.assign(o, { go: true, cls: 'go current', ico: 'ico-todo', icon: ICO.alert, metaColor: s.isPastDeadline ? 'var(--red)' : 'var(--black)',
            meta: (s.deadline ? t('due', { date: s.deadline }) : t('tapStart')) + (s.isPastDeadline ? ' — ' + t('pastDue') : '') });
        }
        return trowHtml(o);
      }).join('');
      show('specialWrap');
    } else {
      hide('specialWrap');
    }
  }

  function onRowActivate(ev) {
    const row = ev.target.closest('.trow.go');
    if (!row) return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    openTraining(row.dataset.kind, row.dataset.id);
  }
  ['monthList', 'specialList'].forEach(function (id) {
    $(id).addEventListener('click', onRowActivate);
    $(id).addEventListener('keydown', onRowActivate);
  });

  // ── TRAINING VIEW ────────────────────────────────────────
  async function openTraining(kind, id) {
    hide('emp-home'); show('emp-training');
    stopTimer();
    $('trainWho').textContent = APP.emp.firstName + ' ' + APP.emp.lastName + ' — ' + (APP.emp.warehouse || '');
    $('backLbl').textContent = t('back');
    $('topicLbl').textContent = ''; $('topicName').textContent = '...'; $('topicDesc').textContent = '';
    $('vidFrame').src = 'about:blank';
    hide('doneBanner'); hide('quizBody'); show('quizLocked'); hide('resultPanel');
    $('lblVideo').textContent = t('video'); $('vidInstr').textContent = t('watch');
    $('lblTimeLeft').textContent = t('timeLeft');
    $('lblQuiz').textContent = t('quiz'); $('lblQuizSub').textContent = t('quizSub'); $('lblQuizLocked').textContent = t('quizLocked');
    $('progFill').style.width = '0%'; $('progFill').classList.remove('done'); $('timerVal').textContent = '--:--';
    window.scrollTo(0, 0);

    try {
      const r = kind === 'm'
        ? await API.call('training', { month: parseInt(id), lang: APP.lang }, APP.empToken)
        : await API.call('specialTraining', { trainingId: id, lang: APP.lang }, APP.empToken);
      if (!r.success) throw new Error(r.message || t('loadErr'));
      APP.cur = { kind: kind, id: id, data: r };
      populateTraining(r);
    } catch (e) {
      $('topicName').textContent = '';
      alertBox('doneBanner', 'error', e.message || t('loadErr'));
    }
  }

  function populateTraining(d) {
    const isM = APP.cur.kind === 'm';
    $('topicLbl').textContent = isM ? t('safety', { month: d.monthName }) : t('specialOne');
    $('topicName').textContent = isM ? d.topic : d.title;
    $('topicDesc').textContent = d.description || '';
    const vid = String(d.videoId || '').trim();
    $('vidFrame').src = vid ? 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(vid) + '?rel=0&modestbranding=1&playsinline=1' : 'about:blank';

    const total = parseInt(d.durationSec) || 240;
    if (d.status === 'complete') {
      alertBox('doneBanner', 'success', t('alreadyDone', { date: d.completedAt || '' }));
      finishTimer(); hide('quizLocked'); hide('quizBody');
      return;
    }
    buildQuiz();
    if ((parseInt(d.remainingSec) || 0) <= 0) { APP.timerTotal = total; finishTimer(); }
    else startTimer(parseInt(d.remainingSec), total);
  }

  // Timer — mirrors the server-side check in Api.gs
  function startTimer(left, total) {
    stopTimer();
    APP.timerLeft = left; APP.timerTotal = total; APP.timerRunning = true;
    paintTimer();
    APP.timer = setInterval(function () {
      APP.timerLeft--; paintTimer();
      if (APP.timerLeft <= 0) finishTimer();
    }, 1000);
  }
  function paintTimer() {
    const s = Math.max(APP.timerLeft, 0);
    $('timerVal').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    $('progFill').style.width = Math.min(100, Math.round(((APP.timerTotal - s) / APP.timerTotal) * 100)) + '%';
  }
  function stopTimer() { clearInterval(APP.timer); APP.timer = null; APP.timerRunning = false; }
  function finishTimer() {
    stopTimer();
    $('timerVal').textContent = t('ready');
    $('progFill').style.width = '100%'; $('progFill').classList.add('done');
    $('vidInstr').textContent = t('videoDone');
    if (APP.cur && APP.cur.data.status !== 'complete') {
      hide('quizLocked'); show('quizBody');
      setTimeout(function () { $('quizCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300);
    }
  }

  function buildQuiz() {
    const qs = APP.cur.data.questions || [];
    $('quizQs').innerHTML = qs.map(function (q, qi) {
      return '<div class="qblock">' +
        '<div class="qnum">' + esc(t('question', { n: qi + 1, t: qs.length })) + '</div>' +
        '<div class="qtext">' + esc(q.q) + '</div>' +
        '<div class="opts">' + q.options.map(function (opt, oi) {
          return '<label class="opt" id="opt-' + qi + '-' + oi + '"><input type="radio" name="q' + qi + '" value="' + oi + '"><span>' + esc(opt) + '</span></label>';
        }).join('') + '</div></div>';
    }).join('');
    $('ackText').textContent = t('ack');
    $('ackCheck').checked = false;
    $('submitBtn').textContent = t('submit'); $('submitBtn').disabled = false;
    hide('quizErr'); hide('resultPanel'); show('quizSubmitArea');
  }

  $('quizQs').addEventListener('change', function (ev) {
    if (ev.target.type !== 'radio') return;
    const qi = ev.target.name.slice(1);
    document.querySelectorAll('[id^="opt-' + qi + '-"]').forEach(function (el) { el.classList.remove('sel'); });
    ev.target.closest('.opt').classList.add('sel');
  });

  $('submitBtn').addEventListener('click', async function () {
    const cur = APP.cur; if (!cur) return;
    const qs = cur.data.questions || [];
    const err = $('quizErr'); hide(err);
    if (!$('ackCheck').checked) return alertBox(err, 'error', t('mustAck'));
    const picked = [];
    for (let i = 0; i < qs.length; i++) {
      const c = document.querySelector('input[name="q' + i + '"]:checked');
      if (!c) return alertBox(err, 'error', t('answerAll'));
      picked.push(parseInt(c.value));
    }
    const answers = picked.map(function (oi, i) { return qs[i].options[oi]; });
    const btn = $('submitBtn'); btn.disabled = true; btn.textContent = t('submitting');
    try {
      const r = cur.kind === 'm'
        ? await API.call('submitQuiz', { month: parseInt(cur.id), lang: APP.lang, answers: answers, acknowledged: true }, APP.empToken)
        : await API.call('submitSpecial', { trainingId: cur.id, lang: APP.lang, answers: answers, acknowledged: true }, APP.empToken);
      if (!r.success) {
        alertBox(err, 'error', r.message || 'Error.');
        if (r.restartTimer) setTimeout(function () { openTraining(cur.kind, cur.id); }, 2500);
        return;
      }
      showResult(r, picked);
    } catch (e) {
      alertBox(err, 'error', e.message);
    } finally {
      btn.disabled = false; btn.textContent = t('submit');
    }
  });

  function showResult(r, picked) {
    const qs = APP.cur.data.questions || [];
    const results = r.results || [];
    qs.forEach(function (q, qi) {
      q.options.forEach(function (_, oi) {
        const el = $('opt-' + qi + '-' + oi); if (!el) return;
        el.classList.remove('sel'); el.querySelector('input').disabled = true;
        if (oi === picked[qi]) el.classList.add(results[qi] || r.passed ? 'ok' : 'bad');
      });
    });
    hide('quizSubmitArea');
    const p = $('resultPanel'); p.classList.remove('hidden');
    const topic = APP.cur.kind === 'm' ? APP.cur.data.topic : APP.cur.data.title;
    if (r.passed) {
      p.innerHTML = '<div class="result-ico pass">' + ICO.check + '</div>' +
        '<div class="result-title pass">' + esc(t('passTitle')) + '</div>' +
        '<div class="result-score">100%</div>' +
        '<div class="result-sub">' + esc(t('passSub', { topic: topic })) + '<br>' + esc(r.onTime ? t('onTime') : t('late')) + '</div>' +
        '<div class="alert alert-success" style="text-align:start;">' + esc(t('recorded')) + '</div>' +
        '<button class="btn btn-black btn-block" type="button" data-act="home">' + esc(t('viewMine')) + '</button>';
    } else {
      const left = parseInt(r.attemptsLeft) || 0;
      p.innerHTML = '<div class="result-ico fail">' + ICO.x + '</div>' +
        '<div class="result-title fail">' + esc(t('failTitle')) + '</div>' +
        '<div class="result-score">' + esc(r.score) + '%</div>' +
        '<div class="result-sub">' + esc(t('failSub', { c: r.correct, t: r.total })) + '<br>' + esc(t('wrongMarked')) + '<br><strong>' +
          esc(left > 0 ? t('left', { n: left }) : t('nowLocked')) + '</strong></div>' +
        (left > 0 ? '<button class="btn btn-red btn-block" type="button" data-act="retake">' + esc(t('retake')) + '</button>'
                  : '<button class="btn btn-black btn-block" type="button" data-act="home">' + esc(t('viewMine')) + '</button>');
    }
    p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('resultPanel').addEventListener('click', function (ev) {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'home') showEmpHome();
    if (b.dataset.act === 'retake') {
      APP.cur.data.questions.forEach(function (q) { q.options = shuffle(q.options); });
      buildQuiz();
      $('quizQs').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  $('backBtn').addEventListener('click', showEmpHome);

  // ── IDLE SIGN-OUT (shared devices) ───────────────────────
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { APP.lastActivity = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    const limit = (LWH_CONFIG.EMP_IDLE_MINUTES || 15) * 60000;
    if (APP.empToken && !APP.timerRunning && Date.now() - APP.lastActivity > limit) {
      empLogout(); alertBox('empLoginErr', 'info', 'You were signed out after ' + (LWH_CONFIG.EMP_IDLE_MINUTES || 15) + ' minutes of inactivity.');
    }
  }, 30000);

  // ── ONLINE / OFFLINE ─────────────────────────────────────
  function netState() { show('offlineBar', !navigator.onLine); }
  window.addEventListener('online', netState); window.addEventListener('offline', netState);

  // ── SERVICE WORKER + UPDATE BAR ──────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        function prompt(w) { show('updateBar'); $('updateBtn').onclick = function () { w.postMessage('SKIP_WAITING'); }; }
        if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
        reg.addEventListener('updatefound', function () {
          const w = reg.installing;
          w.addEventListener('statechange', function () {
            if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
          });
        });
        setInterval(function () { reg.update().catch(function () {}); }, 60 * 60000);
      }).catch(function () {});
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloading) return; reloading = true; location.reload();
      });
    });
  }

  // ── BOOT ─────────────────────────────────────────────────
  $('appVer').textContent = 'v' + LWH_CONFIG.APP_VERSION;
  netState();
  try {
    const saved = JSON.parse(sessionStorage.getItem('lwh_st_emp') || 'null');
    if (saved && saved.token) { APP.emp = saved.emp; APP.empToken = saved.token; APP.lang = saved.lang || 'EN'; }
  } catch (e) {}
  loadEmployees();
  if (APP.empToken) showEmpHome();
  const startTab = (location.hash || '').replace('#', '');
  showTab(['mgr', 'special', 'inc'].indexOf(startTab) >= 0 ? startTab : 'emp');
})();
