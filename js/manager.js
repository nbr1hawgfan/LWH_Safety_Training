// ============================================================
// LWH Safety Training — Manager / HR: dashboard, special
// trainings, incident reporting. One PIN sign-in covers all.
// ============================================================
(function () {
  'use strict';
  const APP = window.APP;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const state = { inited: {}, dashRows: [], dash: null, specialLoaded: false, lastIncidentId: null };

  function call(action, payload) { return API.call(action, payload, APP.mgrToken); }
  function isWide() { return window.innerWidth >= 760; }
  function yearOptions(sel, back) {
    const y = new Date().getFullYear();
    let h = ''; for (let i = y; i >= Math.min(2025, y - (back || 0)); i--) h += '<option value="' + i + '">' + i + '</option>';
    $(sel).innerHTML = h;
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.lbl = btn.innerHTML; btn.disabled = true; btn.textContent = label || 'Working...'; }
    else { btn.disabled = false; if (btn.dataset.lbl) btn.innerHTML = btn.dataset.lbl; }
  }

  // ── LOGIN / LOGOUT ───────────────────────────────────────
  $('mgrLoginForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const pin = $('mgrPin').value.trim(), err = $('mgrLoginErr'), btn = $('mgrLoginBtn');
    hide(err);
    if (!pin) return alertBox(err, 'error', 'Please enter your PIN.');
    busy(btn, true, 'Signing in...');
    try {
      const r = await API.call('mgrLogin', { pin: pin });
      if (!r.success) { $('mgrPin').value = ''; return alertBox(err, 'error', r.message || 'Invalid PIN.'); }
      APP.mgrToken = r.token; APP.mgrRole = r.role;
      try { sessionStorage.setItem('lwh_st_mgr', JSON.stringify({ token: r.token, role: r.role })); } catch (e) {}
      $('mgrPin').value = '';
      showTab(APP.pendingTab || 'mgr');
    } catch (e) { alertBox(err, 'error', e.message); }
    finally { busy(btn, false); }
  });

  function logout() {
    if (APP.mgrToken) API.call('logout', {}, APP.mgrToken).catch(function () {});
    APP.mgrToken = ''; APP.mgrRole = '';
    try { sessionStorage.removeItem('lwh_st_mgr'); } catch (e) {}
    state.dash = null; state.specialLoaded = false;
    APP.pendingTab = APP.tab === 'emp' ? 'mgr' : APP.tab;
    showTab(APP.tab);
  }

  function onShow(tab) {
    if (tab === 'mgr')     initDash();
    if (tab === 'special') initSpecial();
    if (tab === 'inc')     initIncidents();
  }

  function fillEmployeeSelects() {
    const opts = APP.employees.map(function (e) {
      return '<option value="' + esc(e.employeeId) + '">' + esc(e.displayName) + (e.warehouse ? ' (' + esc(e.warehouse) + ')' : '') + '</option>';
    }).join('');
    $('transcriptEmp').innerHTML = '<option value="">-- Select employee --</option>' + opts;
    $('inc_pick').innerHTML = '<option value="">-- Optional: select from employee list --</option>' + opts;
  }

  // ════════════════════════════════════════════════════════
  // DASHBOARD
  // ════════════════════════════════════════════════════════
  function initDash() {
    if (!state.inited.dash) {
      state.inited.dash = true;
      $('dashMonth').innerHTML = MONTHS.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join('');
      $('dashMonth').value = new Date().getMonth() + 1;
      yearOptions('dashYear');
      ['dashMonth', 'dashYear'].forEach(function (id) { $(id).addEventListener('change', loadDashboard); });
      $('dashRefresh').addEventListener('click', loadDashboard);
      ['fSearch', 'fWarehouse', 'fStatus'].forEach(function (id) { $(id).addEventListener(id === 'fSearch' ? 'input' : 'change', applyFilters); });
      $('btnCsv').addEventListener('click', exportDashCsv);
      $('btnPrint').addEventListener('click', function () { window.print(); });
      $('btnTranscript').addEventListener('click', function () {
        const c = $('transcriptCard'); c.classList.toggle('hidden'); hide('transcriptMsg');
        if (!c.classList.contains('hidden')) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $('transcriptBtn').addEventListener('click', genTranscript);
      $('mgrTbody').addEventListener('click', onResetClick);
      $('mgrCards').addEventListener('click', onResetClick);
      let rT; window.addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(applyFilters, 150); });
    }
    if (!state.dash) loadDashboard();
  }

  async function loadDashboard() {
    show('dashSpin'); hide('dashBody');
    try {
      const d = await call('dashboard', { month: parseInt($('dashMonth').value), year: parseInt($('dashYear').value) });
      if (!d.success) throw new Error(d.message || 'Could not load dashboard.');
      state.dash = d; state.dashRows = d.rows || [];
      $('dashTitle').textContent = d.monthName + ' ' + d.year + ' Safety Training';
      $('dashSub').textContent = d.topic + ' · Deadline: ' + d.monthName + ' ' + d.deadlineDay + ' · As of ' + d.today;
      $('stTotal').textContent = d.stats.total; $('stComplete').textContent = d.stats.complete;
      $('stOnTime').textContent = d.stats.onTimeCount; $('stIncomplete').textContent = d.stats.incomplete;
      const locked = state.dashRows.filter(function (r) { return r.locked; }).length;
      const a = $('dashAlert');
      if (d.stats.total === 0) alertBox(a, 'info', 'No active employees found.');
      else if (d.stats.incomplete === 0) alertBox(a, 'success', 'All employees have completed this training.');
      else if (d.pastDeadline) alertBox(a, 'error', 'DEADLINE PASSED: ' + d.stats.incomplete + ' employee(s) did not complete on time.' + (locked ? ' ' + locked + ' locked out.' : ''));
      else alertBox(a, 'warn', d.stats.incomplete + ' employee(s) have not completed this training yet.' + (locked ? ' ' + locked + ' locked out.' : ''));
      const whs = Array.from(new Set(state.dashRows.map(function (r) { return r.warehouse; }).filter(Boolean))).sort();
      const cur = $('fWarehouse').value;
      $('fWarehouse').innerHTML = '<option value="">All Warehouses</option>' + whs.map(function (w) { return '<option>' + esc(w) + '</option>'; }).join('');
      if (whs.indexOf(cur) >= 0) $('fWarehouse').value = cur;
      applyFilters();
      show('dashBody');
    } catch (e) {
      show('dashBody'); alertBox('dashAlert', 'error', e.message);
    }
    hide('dashSpin');
  }

  function statusBadge(r) {
    if (r.locked) return '<span class="badge b-black">Locked Out</span>';
    if (r.status.indexOf('On Time') >= 0) return '<span class="badge b-green">Complete — On Time</span>';
    if (r.status.indexOf('Late') >= 0) return '<span class="badge b-amber">Complete — Late</span>';
    if (r.status === 'In Progress') return '<span class="badge b-blue">In Progress</span>';
    return '<span class="badge b-red">Not Started</span>';
  }
  function onTimeBadge(v) {
    if (v === 'Yes') return '<span class="badge b-green">On Time</span>';
    if (v === 'No') return '<span class="badge b-red">Late</span>';
    return '<span class="badge b-gray">—</span>';
  }

  function applyFilters() {
    if (!state.dash) return;
    const s = $('fSearch').value.toLowerCase().trim(), w = $('fWarehouse').value, st = $('fStatus').value;
    const rows = state.dashRows.filter(function (r) {
      return (!s || r.name.toLowerCase().indexOf(s) >= 0 || String(r.employeeId).toLowerCase().indexOf(s) >= 0) &&
             (!w || r.warehouse === w) &&
             (!st || (st === 'Locked' ? r.locked : r.status.indexOf(st) >= 0));
    });
    show('mgrEmpty', !rows.length);
    const resetBtn = function (r) {
      return r.locked ? '<button class="btn btn-red btn-xs no-print" data-reset="' + esc(r.employeeId) + '" data-name="' + esc(r.name) + '">Reset Lockout</button>' : '';
    };
    if (isWide()) {
      hide('mgrCards'); show('mgrTblCard', rows.length > 0);
      $('mgrTbody').innerHTML = rows.map(function (r) {
        return '<tr><td><strong>' + esc(r.name) + '</strong></td><td>' + esc(r.employeeId) + '</td><td>' + esc(r.warehouse) + '</td>' +
          '<td>' + statusBadge(r) + '</td><td class="muted">' + esc(r.completedAt) + '</td><td>' + onTimeBadge(r.onTime) + '</td>' +
          '<td class="center">' + r.attempts + '</td><td class="no-print">' + resetBtn(r) + '</td></tr>';
      }).join('');
    } else {
      hide('mgrTblCard'); show('mgrCards');
      $('mgrCards').innerHTML = rows.map(function (r) {
        return '<div class="ecard"><div class="ecard-name">' + esc(r.name) + '</div><div class="ecard-meta">' +
          '<span>' + esc(r.warehouse) + '</span>' + statusBadge(r) + (r.completedAt ? '<span>' + esc(r.completedAt) + '</span>' : '') +
          onTimeBadge(r.onTime) + (r.attempts ? '<span>Attempts: ' + r.attempts + '</span>' : '') + resetBtn(r) + '</div></div>';
      }).join('');
    }
  }

  async function onResetClick(ev) {
    const b = ev.target.closest('[data-reset]'); if (!b) return;
    if (!confirm('Reset the lockout for ' + b.dataset.name + '? They will get 5 new attempts for this month.')) return;
    busy(b, true, 'Resetting...');
    try {
      const r = await call('resetLockout', { employeeId: b.dataset.reset, month: parseInt($('dashMonth').value), year: parseInt($('dashYear').value) });
      if (!r.success) throw new Error(r.message);
      toast('Lockout reset for ' + b.dataset.name + '.');
      loadDashboard();
    } catch (e) { busy(b, false); alert('Error: ' + e.message); }
  }

  function exportDashCsv() {
    if (!state.dashRows.length) return alert('No data to export.');
    const d = state.dash;
    csvDownload(['Name', 'Employee ID', 'Warehouse', 'Department', 'Status', 'Locked Out', 'Completed', 'On Time', 'Attempts'],
      state.dashRows.map(function (r) { return [r.name, r.employeeId, r.warehouse, r.department, r.status, r.locked ? 'Yes' : '', r.completedAt, r.onTime, r.attempts]; }),
      'SafetyTraining_' + d.monthName + '_' + d.year + '.csv');
  }

  async function genTranscript() {
    const id = $('transcriptEmp').value, btn = $('transcriptBtn');
    if (!id) return alertBox('transcriptMsg', 'error', 'Please select an employee.');
    busy(btn, true, 'Generating...'); hide('transcriptMsg');
    try {
      const r = await call('transcript', { employeeId: id });
      if (!r.success) throw new Error(r.message);
      alertBox('transcriptMsg', 'success', 'Transcript generated for ' + r.name + ' (' + r.complete + ' of 12 months). Emailed to HR and managers and saved to Drive.');
    } catch (e) { alertBox('transcriptMsg', 'error', e.message); }
    finally { busy(btn, false); }
  }

  // ════════════════════════════════════════════════════════
  // SPECIAL TRAININGS
  // ════════════════════════════════════════════════════════
  function initSpecial() {
    if (!state.inited.special) {
      state.inited.special = true;
      let h = '';
      for (let q = 1; q <= 5; q++) {
        h += '<div class="qfield"><div class="qfield-h">Question ' + q + (q === 1 ? ' (required)' : ' (optional)') + '</div>' +
          '<div class="fgrp"><label class="flbl">Question</label><input type="text" id="q' + q + '_q" class="finp"></div>' +
          '<div class="fgrp"><label class="flbl">Correct Answer</label><input type="text" id="q' + q + '_c" class="finp" style="border-color:var(--green);"></div>' +
          '<div class="grid3">' +
            '<div class="fgrp"><label class="flbl">Wrong Answer</label><input type="text" id="q' + q + '_b" class="finp"></div>' +
            '<div class="fgrp"><label class="flbl">Wrong Answer</label><input type="text" id="q' + q + '_c2" class="finp"></div>' +
            '<div class="fgrp"><label class="flbl">Wrong Answer</label><input type="text" id="q' + q + '_d" class="finp"></div>' +
          '</div></div>';
      }
      $('qFields').innerHTML = h;
      $('btnNewSpecial').addEventListener('click', function () {
        const c = $('createCard'); c.classList.toggle('hidden'); hide('createMsg');
        if (!c.classList.contains('hidden')) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $('createCancel').addEventListener('click', function () { hide('createCard'); });
      $('cf_assignType').addEventListener('change', function () {
        const v = this.value, inp = $('cf_assignTo'), lbl = $('cf_assignToLbl');
        if (v === 'ALL') { lbl.textContent = 'Value'; inp.value = 'ALL'; inp.readOnly = true; }
        else if (v === 'WAREHOUSE') { lbl.textContent = 'Warehouse Codes (comma-separated)'; inp.value = ''; inp.readOnly = false; inp.placeholder = 'WHSE10,WHSE40'; }
        else { lbl.textContent = 'Employee IDs (comma-separated)'; inp.value = ''; inp.readOnly = false; inp.placeholder = 'EMP001,EMP002'; }
      });
      $('createBtn').addEventListener('click', createSpecial);
      $('specBody').addEventListener('click', onSpecialClick);
    }
    if (!state.specialLoaded) loadSpecial();
  }

  function ytId(v) {
    v = String(v || '').trim();
    const m = v.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : v;
  }

  async function createSpecial() {
    const msg = $('createMsg'); hide(msg);
    const g = function (id) { return $(id).value.trim(); };
    const f = {
      title: g('cf_title'), description: g('cf_desc'), videoId: ytId(g('cf_video')),
      duration: Math.round((parseFloat(g('cf_duration')) || 5) * 60),
      assignType: $('cf_assignType').value, assignTo: g('cf_assignTo').toUpperCase().replace(/\s+/g, ''),
      deadline: '', assignedBy: g('cf_by'),
    };
    const dl = g('cf_deadline');
    if (dl) { const p = dl.split('-'); f.deadline = p[1] + '/' + p[2] + '/' + p[0]; }
    if (!f.title) return alertBox(msg, 'error', 'Training title is required.');
    if (!/^[A-Za-z0-9_-]{11}$/.test(f.videoId)) return alertBox(msg, 'error', 'Enter a valid YouTube link or 11-character video ID.');
    if (f.assignType !== 'ALL' && !f.assignTo) return alertBox(msg, 'error', 'Enter who this training is assigned to.');
    if (!f.assignedBy) return alertBox(msg, 'error', 'Enter your name in Created By.');
    for (let q = 1; q <= 5; q++) {
      const vals = [g('q' + q + '_q'), g('q' + q + '_c'), g('q' + q + '_b'), g('q' + q + '_c2'), g('q' + q + '_d')];
      const any = vals.some(Boolean), all = vals.every(Boolean);
      if (q === 1 && !all) return alertBox(msg, 'error', 'Question 1 needs the question, the correct answer and three wrong answers.');
      if (any && !all) return alertBox(msg, 'error', 'Question ' + q + ' is incomplete. Fill in all five boxes or leave it all blank.');
      f['q' + q] = vals[0]; f['a' + q + 'c'] = vals[1]; f['a' + q + 'b'] = vals[2]; f['a' + q + 'c2'] = vals[3]; f['a' + q + 'd'] = vals[4];
    }
    const btn = $('createBtn'); busy(btn, true, 'Creating...');
    try {
      const r = await call('createSpecial', { formData: f });
      if (!r.success) throw new Error(r.message || 'Error creating training.');
      alertBox(msg, 'success', 'Training ' + r.trainingId + ' created. HR and managers were notified.');
      document.querySelectorAll('#createCard input[type=text], #createCard input[type=date]').forEach(function (i) { if (!i.readOnly) i.value = ''; });
      setTimeout(function () { hide('createCard'); loadSpecial(); }, 1500);
    } catch (e) { alertBox(msg, 'error', e.message); }
    finally { busy(btn, false); }
  }

  async function loadSpecial() {
    show('specSpin'); $('specBody').innerHTML = '';
    try {
      const d = await call('specialDash');
      if (!d.success) throw new Error(d.message);
      state.specialLoaded = true;
      renderSpecial(d.trainings || []);
    } catch (e) { $('specBody').innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; }
    hide('specSpin');
  }

  function renderSpecial(list) {
    if (!list.length) { $('specBody').innerHTML = '<div class="alert alert-info">No special trainings yet. Use New Special Training to create one.</div>'; return; }
    $('specBody').innerHTML = list.map(function (t) {
      const pct = t.total ? Math.round(t.complete / t.total * 100) : 0;
      const rows = (t.empRows || []).map(function (r) {
        const b = r.locked ? 'b-black' : r.status === 'Complete' ? 'b-green' : r.status === 'In Progress' ? 'b-blue' : 'b-red';
        return '<tr><td><strong>' + esc(r.name) + '</strong></td><td>' + esc(r.warehouse) + '</td>' +
          '<td><span class="badge ' + b + '">' + (r.locked ? 'Locked Out' : esc(r.status)) + '</span></td>' +
          '<td class="muted">' + esc(r.completedAt) + '</td><td class="center">' + r.attempts + '</td>' +
          '<td>' + (r.locked ? '<button class="btn btn-red btn-xs" data-sreset="' + esc(r.employeeId) + '" data-tid="' + esc(t.trainingId) + '" data-name="' + esc(r.name) + '">Reset Lockout</button>' : '') + '</td></tr>';
      }).join('');
      return '<div class="card">' +
        '<div class="card-hd"><div><h2>' + esc(t.title) + '</h2>' +
          '<p>' + esc(t.trainingId) + ' · Assigned: ' + esc(t.assignType) + (t.assignType !== 'ALL' ? ' — ' + esc(t.assignTo) : '') +
          ' · Deadline: ' + esc(t.deadline || 'None') + ' · By ' + esc(t.assignedBy || '—') + '</p></div>' +
          '<span class="badge ' + (t.active ? 'b-green' : 'b-gray') + '">' + (t.active ? 'ACTIVE' : 'INACTIVE') + '</span></div>' +
        '<div class="card-bd">' +
          '<div class="progress-row"><div class="pbar"><div style="width:' + pct + '%"></div></div>' +
            '<strong>' + t.complete + ' / ' + t.total + ' (' + pct + '%)</strong>' +
            '<button class="btn ' + (t.active ? 'btn-line' : 'btn-red') + ' btn-sm" data-toggle="' + esc(t.trainingId) + '" data-active="' + (t.active ? '0' : '1') + '">' + (t.active ? 'Deactivate' : 'Activate') + '</button></div>' +
          (rows ? '<div class="tbl-wrap"><table class="dtbl"><thead><tr><th>Name</th><th>Warehouse</th><th>Status</th><th>Completed</th><th>Attempts</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
                : '<p class="muted">No active employees match this assignment.</p>') +
        '</div></div>';
    }).join('');
  }

  async function onSpecialClick(ev) {
    const tg = ev.target.closest('[data-toggle]');
    if (tg) {
      const on = tg.dataset.active === '1';
      if (!confirm((on ? 'Activate' : 'Deactivate') + ' ' + tg.dataset.toggle + '?' + (on ? ' Assigned employees will see it on their training list.' : ''))) return;
      busy(tg, true, '...');
      try { const r = await call('toggleSpecial', { trainingId: tg.dataset.toggle, active: on }); if (!r.success) throw new Error(r.message); loadSpecial(); }
      catch (e) { busy(tg, false); alert('Error: ' + e.message); }
      return;
    }
    const rs = ev.target.closest('[data-sreset]');
    if (rs) {
      if (!confirm('Reset the lockout for ' + rs.dataset.name + ' on ' + rs.dataset.tid + '?')) return;
      busy(rs, true, 'Resetting...');
      try { const r = await call('resetSpecialLockout', { employeeId: rs.dataset.sreset, trainingId: rs.dataset.tid }); if (!r.success) throw new Error(r.message); toast('Lockout reset.'); loadSpecial(); }
      catch (e) { busy(rs, false); alert('Error: ' + e.message); }
    }
  }

  // ════════════════════════════════════════════════════════
  // INCIDENTS
  // ════════════════════════════════════════════════════════
  function initIncidents() {
    if (state.inited.inc) return;
    state.inited.inc = true;
    yearOptions('incLogYear'); yearOptions('oshaYear');
    document.querySelectorAll('.subtab').forEach(function (b) { b.addEventListener('click', function () { incTab(b.dataset.inc); }); });
    $('inc_oshaRecordable').addEventListener('change', function () { show('inc_oshaTypeWrap', this.value === 'Yes'); });
    $('inc_pick').addEventListener('change', function () {
      const e = APP.employees.find(function (x) { return x.employeeId === this.value; }, this);
      if (!e) return;
      const parts = e.displayName.trim().split(/\s+/);
      const last = parts.length > 1 ? parts.pop() : '';
      $('inc_empName').value = last ? last + ', ' + parts.join(' ') : e.displayName;
      $('inc_empId').value = e.employeeId;
      const opt = Array.prototype.find.call($('inc_warehouse').options, function (o) { return o.value === e.warehouse; });
      if (opt) $('inc_warehouse').value = e.warehouse;
    });
    $('incSubmitBtn').addEventListener('click', submitIncident);
    $('wcBtn').addEventListener('click', downloadWC);
    $('incClear').addEventListener('click', function () {
      if (!confirm('Clear every field on this form?')) return;
      document.querySelectorAll('#inc-new input, #inc-new textarea').forEach(function (i) { i.value = i.type === 'number' ? '0' : ''; });
      document.querySelectorAll('#inc-new select').forEach(function (s) { s.selectedIndex = 0; });
      hide('inc_oshaTypeWrap'); hide('incMsg'); state.lastIncidentId = null;
    });
    $('incLogRefresh').addEventListener('click', loadIncLog);
    $('incLogYear').addEventListener('change', loadIncLog);
    $('incCsv').addEventListener('click', exportIncCsv);
    $('oshaRefresh').addEventListener('click', loadOsha);
    $('oshaYear').addEventListener('change', loadOsha);
    $('osha300ABtn').addEventListener('click', download300A);
  }

  function incTab(tab) {
    document.querySelectorAll('.subtab').forEach(function (b) { b.classList.toggle('active', b.dataset.inc === tab); });
    ['new', 'log', 'osha'].forEach(function (x) { show('inc-' + x, x === tab); });
    if (tab === 'log') loadIncLog();
    if (tab === 'osha') loadOsha();
  }

  function v(id) { return $(id).value.trim(); }
  function to12(t) {
    if (!t) return { time: '', ap: 'AM' };
    const h = parseInt(t.split(':')[0]), m = t.split(':')[1];
    return { time: (h % 12 === 0 ? 12 : h % 12) + ':' + m, ap: h >= 12 ? 'PM' : 'AM' };
  }

  function collectIncident() {
    const ti = to12(v('inc_timeInjury')), tw = to12(v('inc_timeWorkBegan'));
    return {
      employeeName: v('inc_empName'), employeeId: v('inc_empId'), jobTitle: v('inc_jobTitle'),
      warehouse: v('inc_warehouse'), department: v('inc_warehouse'), employmentStatus: v('inc_empStatus'),
      employeeDOB: v('inc_dob'), dateHired: v('inc_dateHired'), sex: v('inc_sex'), maritalStatus: v('inc_marital'),
      employeeAddress: v('inc_empAddress'), employeePhone: v('inc_empPhone'),
      dateOfInjury: v('inc_dateInjury'), timeOfInjury: ti.time ? ti.time + ' ' + ti.ap : '', amPm: ti.ap,
      timeWorkBegan: tw.time, workBeganAmPm: tw.ap, onPremises: v('inc_onPremises'),
      deptLocation: v('inc_deptLocation'), equipmentUsed: v('inc_equipment') || 'NA',
      specificActivity: v('inc_activity'), workProcess: v('inc_workProcess') || 'NA', sequenceOfEvents: v('inc_sequence'),
      typeOfInjury: v('inc_typeInjury'), partOfBody: v('inc_partBody'), causeOfInjury: v('inc_cause'),
      initialTreatment: v('inc_treatment'), physicianProvider: v('inc_physician'), hospital: v('inc_hospital'),
      safeguardsProvided: v('inc_safeguardsProvided'), safeguardsUsed: v('inc_safeguardsUsed'), fullPayDayOfInjury: v('inc_fullPay'),
      lastWorkDate: v('inc_lastWorkDate'), dateDisabilityBegan: v('inc_disabilityDate'), dateReturnedToWork: v('inc_returnDate'),
      daysAwayWork: v('inc_daysAway') || '0', witnesses: v('inc_witnesses'), contactName: v('inc_contact'),
      oshaRecordable: v('inc_oshaRecordable'), oshaType: v('inc_oshaRecordable') === 'Yes' ? v('inc_oshaType') : '',
      preparerName: v('inc_preparerName'), preparerPhone: v('inc_preparerPhone'), reportedBy: v('inc_preparerName'),
    };
  }

  async function submitIncident() {
    const msg = $('incMsg'); hide(msg);
    const f = collectIncident();
    if (!f.employeeName) return alertBox(msg, 'error', 'Employee name is required.');
    if (!f.dateOfInjury) return alertBox(msg, 'error', 'Date of injury is required.');
    if (!f.sequenceOfEvents) return alertBox(msg, 'error', 'Describe how the injury occurred.');
    if (!f.preparerName) return alertBox(msg, 'error', 'Preparer name is required.');
    if (state.lastIncidentId && !confirm('Incident ' + state.lastIncidentId + ' was already submitted from this form. Submit a NEW incident?')) return;
    const btn = $('incSubmitBtn'); busy(btn, true, 'Submitting...');
    try {
      const r = await call('submitIncident', { formData: f });
      if (!r.success) throw new Error(r.message);
      state.lastIncidentId = r.incidentId;
      alertBox(msg, 'success', 'Incident ' + r.incidentId + ' logged. HR and managers were notified' +
        (f.oshaRecordable === 'Yes' ? ' and an OSHA 300 entry was created' : '') + '. Use Download Filled WC Form PDF for the carrier copy.');
      msg.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { alertBox(msg, 'error', e.message); }
    finally { busy(btn, false); }
  }

  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve();
    return new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
      s.onload = res; s.onerror = function () { rej(new Error('Could not load the PDF tool. Check your connection.')); };
      document.head.appendChild(s);
    });
  }

  async function downloadWC() {
    const f = collectIncident();
    if (!f.employeeName || !f.dateOfInjury) return alert('Fill in at least the employee name and date of injury first.');
    const btn = $('wcBtn'); busy(btn, true, 'Building PDF...');
    try {
      await loadPdfLib();
      const r = await call('wcForm');
      if (!r.success) throw new Error((r.message || 'WC Form not set up.') + '\n\nAdd the Drive file ID of the blank IA-1 PDF to the Config sheet under "WC Form File ID".');
      const pdf = await PDFLib.PDFDocument.load(await b64ToBlob(r.b64, 'application/pdf').arrayBuffer());
      const form = pdf.getForm();
      const st = function (n, val) { try { form.getTextField(n).setText(String(val || '')); } catch (e) {} };
      const sc = function (n, on) { try { const c = form.getCheckBox(n); if (on) c.check(); else c.uncheck(); } catch (e) {} };
      const ti = to12(v('inc_timeInjury')), tw = to12(v('inc_timeWorkBegan'));
      const today = new Date().toLocaleDateString('en-US');
      const E = LWH_CONFIG.EMPLOYER;

      st('Employer Name and Address', E.nameAddress); st('OSHA Log', state.lastIncidentId || 'PENDING'); st('Phone Number', E.phone);
      st('Employee Name', f.employeeName); st('Date of Birth', fmtDate(f.employeeDOB)); st('Date of Hire', fmtDate(f.dateHired));
      st('State of Hire', E.state); st('Job Title', f.jobTitle); st('Employment Status', f.employmentStatus);
      st('Employee Address', f.employeeAddress); st('Employee Phone', f.employeePhone);
      st('Date of Injury', fmtDate(f.dateOfInjury)); st('Time of Occurrenc', ti.time); st('Time Employee Began Work', tw.time);
      st('Department or Location', f.deptLocation); st('All Equipment', f.equipmentUsed); st('Specific Activity', f.specificActivity);
      st('Work Process', f.workProcess); st('Sequenc of Events', f.sequenceOfEvents); st('Type of Injury or Illness', f.typeOfInjury + (f.partOfBody ? ' — ' + f.partOfBody : ''));
      st('Cause of Injury Code', f.causeOfInjury); st('Last Work Date', fmtDate(f.lastWorkDate)); st('Date Disability Began', fmtDate(f.dateDisabilityBegan));
      st('Date Returned to Work', fmtDate(f.dateReturnedToWork)); st('Witnesses', f.witnesses); st('Contact Name / Phone Number', f.contactName);
      st('Physician Provider', f.physicianProvider); st('Hospital Name', f.hospital);
      st("Preparer's Name and Title", f.preparerName); st("Preparer's Phone Number", f.preparerPhone);
      st('Date Prepared', today); st('Date Employer Notified', today);

      sc('Male', f.sex === 'Male'); sc('Female', f.sex === 'Female'); sc('Unknown', !f.sex);
      sc('Married', f.maritalStatus === 'Married'); sc('Unmarried', f.maritalStatus === 'Single');
      sc('Separated', f.maritalStatus === 'Separated'); sc('Marital Status Unknown', !f.maritalStatus);
      sc("Injury on Employer's Premises Yes", f.onPremises === 'Yes'); sc("Injury on Employer's Premises No", f.onPremises === 'No');
      sc('Occurrence AM', ti.ap === 'AM'); sc('Occurrence PM', ti.ap === 'PM');
      sc('Time Work Began AM', tw.ap === 'AM'); sc('Time Work Began PM', tw.ap === 'PM');
      sc('Safeguards Provided Yes', f.safeguardsProvided === 'Yes'); sc('Safeguards Provided No', f.safeguardsProvided === 'No');
      sc('Safeguards Used Yes', f.safeguardsUsed === 'Yes'); sc('Safeguards Used No', f.safeguardsUsed === 'No');
      sc('Full Pay Day of Injury Yes', f.fullPayDayOfInjury === 'Yes'); sc('Full Pay Day of Injury No', f.fullPayDayOfInjury === 'No');
      const tr = f.initialTreatment;
      sc('No Medical Treatment', tr === 'No Medical Treatment'); sc('Minor by Employer', tr === 'Minor by Employer');
      sc('Minor Clinic', tr.indexOf('Minor Clinic') >= 0); sc('Emergency Care', tr === 'Emergency Care');
      sc('Hospitalized > 24 Hrs', tr.indexOf('Hospitalized') >= 0); sc('Future Major Medical', tr.indexOf('Future') >= 0);

      form.flatten();
      const bytes = await pdf.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'WC_Form_IA1_' + f.employeeName.replace(/[^A-Za-z0-9]+/g, '_') + '_' + f.dateOfInjury + '.pdf');
    } catch (e) { alert('PDF error: ' + e.message); }
    finally { busy(btn, false); }
  }

  async function loadIncLog() {
    show('incLogSpin'); $('incLogBody').innerHTML = '';
    try {
      const d = await call('incidents', { year: parseInt($('incLogYear').value) });
      if (!d.success) throw new Error(d.message);
      state.incidents = d.incidents || [];
      if (!state.incidents.length) { $('incLogBody').innerHTML = '<div class="alert alert-info">No incidents recorded for this year.</div>'; }
      else {
        $('incLogBody').innerHTML = '<div class="card"><div class="tbl-wrap"><table class="dtbl"><thead><tr>' +
          '<th>Incident</th><th>Reported</th><th>Employee</th><th>Warehouse</th><th>Injury Date</th><th>Injury</th><th>Body Part</th><th>Treatment</th><th>OSHA</th><th>Status</th>' +
          '</tr></thead><tbody>' + state.incidents.map(function (r) {
            return '<tr><td><strong>' + esc(r.incidentId) + '</strong></td><td>' + esc(r.dateReported) + '</td><td><strong>' + esc(r.employeeName) + '</strong></td>' +
              '<td>' + esc(r.warehouse) + '</td><td>' + esc(fmtDate(r.dateOfInjury)) + '</td><td>' + esc(r.typeOfInjury) + '</td><td>' + esc(r.partOfBody) + '</td>' +
              '<td>' + esc(r.initialTreatment) + '</td>' +
              '<td>' + (r.oshaRecordable === 'Yes' ? '<span class="badge b-red">Recordable</span>' : '<span class="badge b-gray">No</span>') + '</td>' +
              '<td>' + (r.status === 'Open' ? '<span class="badge b-amber">Open</span>' : '<span class="badge b-green">' + esc(r.status) + '</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div></div>';
      }
    } catch (e) { $('incLogBody').innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; }
    hide('incLogSpin');
  }

  function exportIncCsv() {
    const rows = state.incidents || [];
    if (!rows.length) return alert('No incidents to export. Load the log first.');
    csvDownload(['Incident ID', 'Date Reported', 'Employee', 'Employee ID', 'Job Title', 'Warehouse', 'Date of Injury', 'Type of Injury', 'Part of Body', 'Treatment', 'OSHA Recordable', 'OSHA Case', 'Status'],
      rows.map(function (r) { return [r.incidentId, r.dateReported, r.employeeName, r.employeeId, r.jobTitle, r.warehouse, fmtDate(r.dateOfInjury), r.typeOfInjury, r.partOfBody, r.initialTreatment, r.oshaRecordable, r.oshaCase, r.status]; }),
      'Incidents_' + $('incLogYear').value + '.csv');
  }

  async function loadOsha() {
    show('oshaSpin'); $('oshaBody').innerHTML = '';
    try {
      const d = await call('osha300', { year: parseInt($('oshaYear').value) });
      if (!d.success) throw new Error(d.message);
      const t = d.totals || {};
      $('oshaBody').innerHTML =
        '<div class="stats">' +
          '<div class="stat"><div class="stat-num">' + (t.total || 0) + '</div><div class="stat-lbl">Recordable Cases</div></div>' +
          '<div class="stat red"><div class="stat-num">' + (t.deaths || 0) + '</div><div class="stat-lbl">Deaths</div></div>' +
          '<div class="stat amber"><div class="stat-num">' + (t.daysAway || 0) + '</div><div class="stat-lbl">Days-Away Cases</div></div>' +
          '<div class="stat"><div class="stat-num">' + (t.totalDaysAway || 0) + '</div><div class="stat-lbl">Total Days Lost</div></div>' +
        '</div>' +
        ((d.cases || []).length
          ? '<div class="card"><div class="tbl-wrap"><table class="dtbl"><thead><tr><th>Case</th><th>Employee</th><th>Date</th><th>Location</th><th>Description</th><th>Type</th><th>Days Away</th></tr></thead><tbody>' +
            d.cases.map(function (r) {
              return '<tr><td><strong>' + esc(r.caseNum) + '</strong></td><td><strong>' + esc(r.employee) + '</strong></td><td>' + esc(fmtDate(r.date)) + '</td>' +
                '<td>' + esc(r.location) + '</td><td style="max-width:280px;">' + esc(String(r.description || '').slice(0, 100)) + '</td>' +
                '<td><span class="badge ' + (r.type === 'Death' ? 'b-red' : r.type === 'Days Away' ? 'b-amber' : 'b-blue') + '">' + esc(r.type) + '</span></td>' +
                '<td class="center">' + esc(r.daysAway || 0) + '</td></tr>';
            }).join('') + '</tbody></table></div></div>'
          : '<div class="alert alert-info">No OSHA recordable cases for this year.</div>');
    } catch (e) { $('oshaBody').innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; }
    hide('oshaSpin');
  }

  async function download300A() {
    const yr = parseInt($('oshaYear').value), btn = $('osha300ABtn');
    busy(btn, true, 'Generating...');
    try {
      const r = await call('osha300A', { year: yr });
      if (!r.success) throw new Error(r.message);
      downloadBlob(b64ToBlob(r.b64, 'application/pdf'), r.name);
      toast('300A for ' + yr + ' downloaded' + (r.savedToDrive ? ' and saved to Drive (OSHA_Records).' : '.'));
    } catch (e) { alert('Error: ' + e.message); }
    finally { busy(btn, false); }
  }

  // ── EXPORT + RESTORE SESSION ─────────────────────────────
  window.Mgr = { onShow: onShow, logout: logout, fillEmployeeSelects: fillEmployeeSelects };
  if (APP.employees.length) fillEmployeeSelects();
  try {
    const saved = JSON.parse(sessionStorage.getItem('lwh_st_mgr') || 'null');
    if (saved && saved.token) { APP.mgrToken = saved.token; APP.mgrRole = saved.role; if (APP.tab !== 'emp') showTab(APP.tab); }
  } catch (e) {}
})();
