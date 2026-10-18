// ============================================================
// SAFETY TRAINING PORTAL — Api.gs
// Logistics Warehouse | JSON API for the GitHub Pages PWA
// ============================================================
//
// Add this as a NEW file next to Code.gs (do not paste into Code.gs).
// It reuses every existing function in Code.gs — Sheets stay the database,
// certificates / emails / Drive folders / translation all work as before.
//
// DEPLOY:  Deploy > New deployment > Web app
//          Execute as: Me
//          Who has access: Anyone
//          Copy the /exec URL into js/config.js in the PWA repo.
//
// The PWA POSTs JSON as text/plain:  { action, token, payload }
// (text/plain keeps the request "simple" so the browser skips the
// CORS preflight Apps Script can't answer.)
//
// SECURITY MODEL
//   * Employee PIN login -> session token (Script Cache, 6 hrs, sliding)
//   * Manager/HR PIN login -> separate manager token
//   * Every data call checks the token and its role; employees can only
//     touch their own records
//   * 5 wrong PINs per employee (10 for manager PIN) = 15 min cooldown
//   * Correct answers never leave the server; answer order is shuffled
//     server-side; grading happens here
//   * The video timer is enforced server-side (90% of the duration must
//     elapse between opening the training and submitting)
// ============================================================

const API_SESSION_TTL     = 6 * 60 * 60;  // seconds
const API_EMP_MAX_FAIL    = 5;
const API_MGR_MAX_FAIL    = 10;
const API_LOGIN_COOLDOWN  = 15 * 60;      // seconds
const API_TIMER_GRACE     = 0.9;          // fraction of video timer required
const API_LANGS           = ['EN', 'ES', 'FR', 'RU', 'AR'];


// ── ENTRY POINT ─────────────────────────────────────────────
function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = apiRoute_(String(body.action || ''), body.payload || {}, String(body.token || ''));
  } catch (err) {
    Logger.log('API error: ' + err + '\n' + (err && err.stack ? err.stack : ''));
    out = { success: false, message: 'Server error: ' + (err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── ROUTER ──────────────────────────────────────────────────
function apiRoute_(action, p, token) {
  // Public actions
  switch (action) {
    case 'ping':      return { success: true, time: new Date().toISOString() };
    case 'employees': return { success: true, employees: getEmployeeList() };
    case 'login':     return apiEmployeeLogin_(p);
    case 'mgrLogin':  return apiManagerLogin_(p);
    case 'logout':    apiEndSession_(token); return { success: true };
  }

  const s = apiSession_(token);
  if (!s) return { success: false, authExpired: true, message: 'Your session expired. Please sign in again.' };

  if (s.role === 'employee') {
    switch (action) {
      case 'monthStatus':     return getMonthStatus(s.empId, apiLang_(p.lang));
      case 'training':        return apiTraining_(s, p);
      case 'submitQuiz':      return apiSubmitQuiz_(s, p);
      case 'specialList':     return getSpecialTrainings(s.empId);
      case 'specialTraining': return apiSpecialTraining_(s, p);
      case 'submitSpecial':   return apiSubmitSpecial_(s, p);
    }
  }

  if (s.role === 'manager' || s.role === 'hr') {
    switch (action) {
      case 'dashboard':           return apiDashboard_(p);
      case 'transcript':          return generateTranscriptPDF(String(p.employeeId || '').trim());
      case 'specialDash':         return apiSpecialDashboard_();
      case 'createSpecial':       return apiCreateSpecial_(p.formData || {});
      case 'toggleSpecial':       return apiToggleSpecial_(p);
      case 'resetLockout':        return apiResetLockout_(s, p);
      case 'resetSpecialLockout': return apiResetSpecialLockout_(s, p);
      case 'incidents':           return getIncidents(p.year);
      case 'osha300':             return getOSHA300Summary(p.year);
      case 'osha300A':            return apiOsha300A_(p.year);
      case 'submitIncident':      return submitIncidentReport(p.formData || {});
      case 'wcForm':              return getWCFormBase64();
      case 'formConfig':          return getIncidentFormConfig();
    }
  }

  return { success: false, message: 'Unknown or unauthorized request: ' + action };
}


// ════════════════════════════════════════════════════════════
// SESSIONS + LOGIN THROTTLE
// ════════════════════════════════════════════════════════════
function apiNewSession_(data) {
  const t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  CacheService.getScriptCache().put('sess_' + t, JSON.stringify(data), API_SESSION_TTL);
  return t;
}

function apiSession_(token) {
  if (!token) return null;
  const c = CacheService.getScriptCache();
  const v = c.get('sess_' + token);
  if (!v) return null;
  c.put('sess_' + token, v, API_SESSION_TTL); // sliding expiry
  try { return JSON.parse(v); } catch (e) { return null; }
}

function apiEndSession_(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
}

function apiFails_(key) {
  return parseInt(CacheService.getScriptCache().get(key)) || 0;
}
function apiAddFail_(key) {
  CacheService.getScriptCache().put(key, String(apiFails_(key) + 1), API_LOGIN_COOLDOWN);
}
function apiClearFails_(key) {
  CacheService.getScriptCache().remove(key);
}

function apiEmployeeLogin_(p) {
  const id  = String(p.employeeId || '').trim().toUpperCase();
  const pin = String(p.pin || '').trim();
  if (!id) return { success: false, message: 'Please select your name.' };
  if (!/^\d{4}$/.test(pin)) return { success: false, message: 'PIN must be exactly 4 digits.' };

  const key = 'fail_emp_' + id;
  if (apiFails_(key) >= API_EMP_MAX_FAIL) {
    return { success: false, message: 'Too many incorrect PINs. Wait 15 minutes or contact your manager.' };
  }

  const r = employeeLogin(id, pin);
  if (!r || !r.success) {
    apiAddFail_(key);
    return r || { success: false, message: 'Login error.' };
  }
  apiClearFails_(key);
  r.token = apiNewSession_({ role: 'employee', empId: r.employeeId });
  delete r.managerEmail; // not needed on the device
  return r;
}

function apiManagerLogin_(p) {
  const key = 'fail_mgr';
  if (apiFails_(key) >= API_MGR_MAX_FAIL) {
    return { success: false, message: 'Too many incorrect PINs. Wait 15 minutes and try again.' };
  }
  const r = managerLogin(String(p.pin || '').trim());
  if (!r.success) { apiAddFail_(key); return r; }
  apiClearFails_(key);
  r.token = apiNewSession_({ role: r.role });
  logAudit_(SpreadsheetApp.getActiveSpreadsheet(), r.role.toUpperCase(), 'MGR_LOGIN', 'PWA login as ' + r.role);
  return r;
}


// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function apiLang_(lang) {
  const l = String(lang || 'EN').toUpperCase();
  return API_LANGS.indexOf(l) >= 0 ? l : 'EN';
}

function apiShuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Remove correct answers and shuffle options before anything goes to a device.
function apiStrip_(t) {
  const c = JSON.parse(JSON.stringify(t));
  c.questions = (c.questions || []).map(function (q) {
    return { q: q.q, options: apiShuffle_(q.options || []) };
  });
  return c;
}

// Video timer — start time is recorded the first time a training is opened.
function apiTimerKey_(kind, empId, id) {
  return 'start_' + kind + '_' + String(empId).toUpperCase() + '_' + id;
}
function apiMarkStart_(kind, empId, id) {
  const c = CacheService.getScriptCache();
  const k = apiTimerKey_(kind, empId, id);
  let v = c.get(k);
  if (!v) { v = String(Date.now()); }
  c.put(k, v, API_SESSION_TTL);
  return parseInt(v);
}
function apiElapsed_(kind, empId, id) {
  const v = CacheService.getScriptCache().get(apiTimerKey_(kind, empId, id));
  return v ? Math.floor((Date.now() - parseInt(v)) / 1000) : null;
}
function apiTimerGate_(kind, empId, id, durationSec) {
  const el = apiElapsed_(kind, empId, id);
  if (el === null) {
    return { success: false, restartTimer: true, message: 'Your video session expired. Please watch the video again.' };
  }
  const need = Math.floor((parseInt(durationSec) || 240) * API_TIMER_GRACE);
  if (el < need) return { success: false, message: 'Please finish watching the video before submitting.' };
  return null;
}

function apiCleanAnswers_(raw, count) {
  const answers = (Array.isArray(raw) ? raw : []).map(function (a) { return String(a == null ? '' : a); });
  if (answers.length < count || answers.slice(0, count).some(function (a) { return !a.trim(); })) return null;
  return answers;
}


// ════════════════════════════════════════════════════════════
// MONTHLY TRAINING
// ════════════════════════════════════════════════════════════
function apiTraining_(s, p) {
  const lang = apiLang_(p.lang);
  const mn   = parseInt(p.month);
  const st   = getMonthStatus(s.empId, lang);
  const m    = (st && st.success) ? st.months.find(function (x) { return x.monthNum === mn; }) : null;
  if (!m) return { success: false, message: 'That training is not available.' };

  const t = getTrainingData(lang, mn);
  if (t.error) return { success: false, message: t.error };

  const started = apiMarkStart_('m', s.empId, mn);
  const out = apiStrip_(t);
  const dur = parseInt(t.durationSec) || 240;
  out.success      = true;
  out.status       = m.status;
  out.completedAt  = m.completedAt;
  out.remainingSec = m.status === 'complete' ? 0 : Math.max(0, dur - Math.floor((Date.now() - started) / 1000));
  return out;
}

function apiSubmitQuiz_(s, p) {
  const lang = apiLang_(p.lang);
  const mn   = parseInt(p.month);
  if (!(mn >= 1 && mn <= 12)) return { success: false, message: 'Invalid training month.' };
  if (!p.acknowledged) return { success: false, message: 'Please check the acknowledgment box.' };

  const st = getMonthStatus(s.empId, lang);
  const m  = (st && st.success) ? st.months.find(function (x) { return x.monthNum === mn; }) : null;
  if (!m || !m.canTake) return { success: false, message: 'This training is not available to take right now.' };

  const t = getTrainingData(lang, mn);
  if (t.error) return { success: false, message: t.error };

  const gate = apiTimerGate_('m', s.empId, mn, t.durationSec);
  if (gate) return gate;

  const answers = apiCleanAnswers_(p.answers, t.questions.length);
  if (!answers) return { success: false, message: 'Please answer all questions.' };

  const results = t.questions.map(function (q, i) {
    return answers[i].trim() === String(q.correctAnswer).trim();
  });

  const r = submitQuiz(s.empId, answers, true, lang, mn);
  if (r && r.success) {
    r.results = results;
    if (!r.passed) {
      r.attemptsLeft = checkLockout_(SpreadsheetApp.getActiveSpreadsheet(), s.empId, mn).attemptsLeft;
    }
  }
  return r;
}


// ════════════════════════════════════════════════════════════
// SPECIAL TRAINING
// ════════════════════════════════════════════════════════════
function apiFindSpecial_(empId, trainingId) {
  const list = getSpecialTrainings(empId);
  if (!list || !list.success) return null;
  return list.trainings.find(function (x) { return String(x.trainingId) === String(trainingId); }) || null;
}

function apiSpecialTraining_(s, p) {
  const id   = String(p.trainingId || '').trim();
  const lang = apiLang_(p.lang);
  const st   = apiFindSpecial_(s.empId, id);
  if (!st) return { success: false, message: 'That training is not assigned to you.' };

  const t = getSpecialTrainingData(id, lang);
  if (t.error) return { success: false, message: t.error };

  const started = apiMarkStart_('s', s.empId, id);
  const out = apiStrip_(t);
  const dur = parseInt(t.durationSec) || 300;
  out.success      = true;
  out.status       = st.completed ? 'complete' : (st.locked ? 'locked' : 'open');
  out.completedAt  = st.completedAt;
  out.remainingSec = st.completed ? 0 : Math.max(0, dur - Math.floor((Date.now() - started) / 1000));
  return out;
}

function apiSubmitSpecial_(s, p) {
  const id   = String(p.trainingId || '').trim();
  const lang = apiLang_(p.lang);
  if (!p.acknowledged) return { success: false, message: 'Please check the acknowledgment box.' };

  const st = apiFindSpecial_(s.empId, id);
  if (!st || st.completed || st.locked) return { success: false, message: 'This training is not available to take right now.' };

  const t = getSpecialTrainingData(id, lang);
  if (t.error) return { success: false, message: t.error };

  const gate = apiTimerGate_('s', s.empId, id, t.durationSec);
  if (gate) return gate;

  const answers = apiCleanAnswers_(p.answers, t.questions.length);
  if (!answers) return { success: false, message: 'Please answer all questions.' };

  const results = t.questions.map(function (q, i) {
    return answers[i].trim() === String(q.correctAnswer).trim();
  });

  const r = submitSpecialQuiz(s.empId, id, answers, true, lang);
  if (r && r.success) {
    r.results = results;
    if (!r.passed) {
      r.attemptsLeft = checkSpecialLockout_(SpreadsheetApp.getActiveSpreadsheet(), s.empId, id).attemptsLeft;
    }
  }
  return r;
}


// ════════════════════════════════════════════════════════════
// MANAGER DASHBOARDS (adds lockout flags for the Reset button)
// ════════════════════════════════════════════════════════════
function apiDashboard_(p) {
  const mn = parseInt(p.month) || getCurrentMonthNum();
  const yr = parseInt(p.year)  || new Date().getFullYear();
  const d  = getDashboardDataForMonth(mn, yr);
  if (!d.success) return d;

  const fails = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Results');
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 16).getValues().forEach(function (r) {
      const yrOk = r[15] === '' || isNaN(parseInt(r[15])) || parseInt(r[15]) === yr;
      if (parseInt(r[5]) === mn && yrOk && String(r[9]).trim().toUpperCase() === 'FALSE') {
        const k = String(r[1]).trim().toUpperCase();
        fails[k] = (fails[k] || 0) + 1;
      }
    });
  }
  d.rows.forEach(function (r) {
    r.locked = !String(r.status).startsWith('Complete') &&
               (fails[String(r.employeeId).trim().toUpperCase()] || 0) >= 5;
  });
  return d;
}

function apiSpecialDashboard_() {
  const d = getSpecialDashboardData();
  if (!d.success) return d;

  const fails = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Special_Results');
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().forEach(function (r) {
      if (String(r[8]).trim().toUpperCase() === 'FALSE') {
        const k = String(r[1]).trim().toUpperCase() + '|' + String(r[5]).trim();
        fails[k] = (fails[k] || 0) + 1;
      }
    });
  }
  d.trainings.forEach(function (t) {
    t.empRows.forEach(function (r) {
      r.locked = r.status !== 'Complete' &&
                 (fails[String(r.employeeId).trim().toUpperCase() + '|' + t.trainingId] || 0) >= 5;
    });
  });
  return d;
}

function apiCreateSpecial_(f) {
  if (!String(f.title || '').trim()) return { success: false, message: 'Training title is required.' };
  if (!String(f.videoId || '').trim()) return { success: false, message: 'YouTube video is required.' };
  if (!String(f.q1 || '').trim() || !String(f.a1c || '').trim()) {
    return { success: false, message: 'At least Question 1 and its correct answer are required.' };
  }
  return createSpecialTraining(f);
}

function apiToggleSpecial_(p) {
  const r = toggleSpecialTraining(String(p.trainingId || ''), !!p.active);
  try {
    const c = CacheService.getScriptCache();
    API_LANGS.forEach(function (l) { c.remove('st_' + p.trainingId + '_' + l); });
  } catch (e) {}
  return r;
}

// Lockout reset — failed rows are marked RESET (not deleted) so the audit trail survives.
function apiResetLockout_(s, p) {
  const id = String(p.employeeId || '').trim().toUpperCase();
  const mn = parseInt(p.month);
  const yr = parseInt(p.year) || new Date().getFullYear();
  if (!id || !(mn >= 1 && mn <= 12)) return { success: false, message: 'Employee and month are required.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Results');
  let n = 0;
  if (sh.getLastRow() > 1) {
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 16).getValues();
    data.forEach(function (r, i) {
      const yrOk = r[15] === '' || isNaN(parseInt(r[15])) || parseInt(r[15]) === yr;
      if (String(r[1]).trim().toUpperCase() === id && parseInt(r[5]) === mn && yrOk &&
          String(r[9]).trim().toUpperCase() === 'FALSE') {
        sh.getRange(i + 2, 10).setValue('RESET'); n++;
      }
    });
  }
  logAudit_(ss, id, 'LOCKOUT_RESET', 'Month ' + mn + '/' + yr + ' | ' + n + ' failed attempt(s) cleared | by ' + s.role.toUpperCase() + ' (PWA)');
  return { success: true, cleared: n };
}

function apiResetSpecialLockout_(s, p) {
  const id  = String(p.employeeId || '').trim().toUpperCase();
  const tid = String(p.trainingId || '').trim();
  if (!id || !tid) return { success: false, message: 'Employee and training are required.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Special_Results');
  let n = 0;
  if (sh && sh.getLastRow() > 1) {
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
    data.forEach(function (r, i) {
      if (String(r[1]).trim().toUpperCase() === id && String(r[5]).trim() === tid &&
          String(r[8]).trim().toUpperCase() === 'FALSE') {
        sh.getRange(i + 2, 9).setValue('RESET'); n++;
      }
    });
  }
  logAudit_(ss, id, 'SPECIAL_LOCKOUT_RESET', tid + ' | ' + n + ' failed attempt(s) cleared | by ' + s.role.toUpperCase() + ' (PWA)');
  return { success: true, cleared: n };
}


// ════════════════════════════════════════════════════════════
// OSHA 300A SUMMARY — web-safe version (original uses getUi())
// Returns the PDF as base64 for download and also saves it to Drive.
// ════════════════════════════════════════════════════════════
function apiOsha300A_(year) {
  const yr   = parseInt(year) || (new Date().getFullYear() - 1);
  const data = getOSHA300Summary(yr);
  if (!data.success) return data;

  const config  = getConfig();
  const company = config['Company Name'] || 'Logistics Warehouse';
  const t       = data.totals || {};

  const doc  = DocumentApp.create('OSHA_300A_Summary_' + yr + '_TEMP_' + Date.now());
  const body = doc.getBody();
  body.setPageWidth(792); body.setPageHeight(612);
  body.setMarginTop(36); body.setMarginBottom(36);
  body.setMarginLeft(54); body.setMarginRight(54);

  function addP(text, size, bold, color, spB, spA, align) {
    const p = body.appendParagraph(text);
    const s = {};
    s[DocumentApp.Attribute.FONT_SIZE]            = size;
    s[DocumentApp.Attribute.BOLD]                 = bold;
    s[DocumentApp.Attribute.FOREGROUND_COLOR]     = color || '#222222';
    s[DocumentApp.Attribute.SPACING_BEFORE]       = spB || 0;
    s[DocumentApp.Attribute.SPACING_AFTER]        = spA || 4;
    s[DocumentApp.Attribute.FONT_FAMILY]          = 'Arial';
    s[DocumentApp.Attribute.HORIZONTAL_ALIGNMENT] = align || DocumentApp.HorizontalAlignment.LEFT;
    p.setAttributes(s); return p;
  }
  function addTable(rows) {
    const tbl = body.appendTable();
    rows.forEach(function (row) {
      const tr = tbl.appendTableRow();
      const c1 = tr.appendTableCell(row[0]);
      const c2 = tr.appendTableCell(row[1]);
      c2.getChild(0).asText().setBold(true);
      [c1, c2].forEach(function (c) { c.setPaddingTop(5); c.setPaddingBottom(5); c.setPaddingLeft(8); c.setPaddingRight(8); });
      c1.setWidth(350); c2.setWidth(100);
    });
  }

  const C = DocumentApp.HorizontalAlignment.CENTER;
  addP("OSHA's Form 300A — Summary of Work-Related Injuries and Illnesses", 14, true, '#111111', 0, 4, C);
  addP('Year: ' + yr + '  |  ' + company, 11, false, '#666666', 0, 12, C);
  addP('━'.repeat(80), 10, true, '#C41230', 0, 12, C);
  addP('Establishment Information', 12, true, '#111111', 0, 6);
  addP('Company: ' + company, 11, false, '#333333', 0, 3);
  addP('Location: Fort Smith / Van Buren, Arkansas', 11, false, '#333333', 0, 3);
  addP('Industry: Warehousing & Transportation', 11, false, '#333333', 0, 12);
  addP('Number of Cases', 12, true, '#111111', 0, 6);
  addTable([
    ['Total recordable cases', String(t.total || 0)],
    ['Cases with days away from work', String(t.daysAway || 0)],
    ['Cases with job transfer or restriction', String(t.restriction || 0)],
    ['Other recordable cases', String(t.other || 0)],
    ['Deaths', String(t.deaths || 0)],
  ]);
  addP('Number of Days', 12, true, '#111111', 12, 6);
  addTable([
    ['Total days away from work', String(t.totalDaysAway || 0)],
    ['Total days of job transfer or restriction', String(t.totalRestriction || 0)],
  ]);
  addP('━'.repeat(80), 10, true, '#C41230', 8, 8, C);
  addP('Certification: I certify that I have examined this document and that to the best of my knowledge the entries are true, accurate, and complete.', 10, false, '#888888', 0, 4, C);
  addP('Signature: ________________________   Title: ________________________   Date: ____________', 10, false, '#333333', 8, 0, C);
  doc.saveAndClose();

  const resp = UrlFetchApp.fetch('https://docs.google.com/document/d/' + doc.getId() + '/export?format=pdf', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
  DriveApp.getFileById(doc.getId()).setTrashed(true);

  const pdfName = 'OSHA_300A_Summary_' + yr + '.pdf';
  const pdfBlob = resp.getBlob().setName(pdfName);

  let saved = true;
  try {
    const rootId = config['Certificates Folder ID'];
    const root   = (rootId && rootId !== 'PASTE_FOLDER_ID_HERE') ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();
    const it     = root.getFoldersByName('OSHA_Records');
    const folder = it.hasNext() ? it.next() : root.createFolder('OSHA_Records');
    const old    = folder.getFilesByName(pdfName);
    if (old.hasNext()) old.next().setTrashed(true);
    folder.createFile(pdfBlob.copyBlob());
  } catch (e) {
    saved = false;
    Logger.log('300A Drive save warning: ' + e);
  }

  return {
    success: true, name: pdfName, total: t.total || 0, savedToDrive: saved,
    b64: Utilities.base64Encode(pdfBlob.getBytes()),
  };
}


// ── EDITOR TEST ─────────────────────────────────────────────
// Run from the Apps Script editor to confirm the API layer loads.
function testApi() {
  Logger.log(JSON.stringify(apiRoute_('ping', {}, '')));
  Logger.log('Employees: ' + apiRoute_('employees', {}, '').employees.length);
  Logger.log(JSON.stringify(apiRoute_('dashboard', {}, 'bad-token')));
}
