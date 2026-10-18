// ============================================================
// SAFETY TRAINING PORTAL — TrainingStart.gs
// Per-employee "Training Start Month" + Go Live Year
// ============================================================
//
// Add this as a NEW file (like Api.gs). Then run
// setupTrainingStart() ONCE from the editor.
//
// HOW IT WORKS
//   Employees sheet gets a column: Training_Start_Month
//   HR enters the first month the employee owes training,
//   e.g. 11/1/2026 (shows as "Nov 2026"). Blank = Go Live month.
//
//   An employee owes a month only if it is on/after BOTH:
//     * the Go Live month (Config: Go Live Month + Go Live Year)
//     * their Training_Start_Month
//   Months before that never appear for them, never block them,
//   don't count against them on the dashboard, and they don't
//   get announcement / reminder / overdue emails for them.
//
// GO LIVE YEAR
//   Go Live Month used to apply to every year, which would hide
//   Jan–May again in 2027. With Go Live Year set, the Go Live
//   month only applies to that year; later years start in January.
// ============================================================

const TRAINING_START_HEADER = 'Training_Start_Month';


// ── Effective Go Live month for a given year (13 = nothing that year) ──
function effectiveGoLiveMonth_(config, year) {
  const gm = parseInt(config['Go Live Month']) || 1;
  const gy = parseInt(config['Go Live Year']);
  if (gy && year > gy) return 1;
  if (gy && year < gy) return 13;
  return gm;
}


// ── Map of EMPLOYEE_ID -> {y, m} from the Training_Start_Month column ──
function getTrainingStartMap_(ss) {
  const map = {};
  const sh = (ss || SpreadsheetApp.getActiveSpreadsheet()).getSheetByName('Employees');
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return map;
  const hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });
  const col = hdr.indexOf(TRAINING_START_HEADER.toLowerCase());
  if (col < 0) return map;
  const ids  = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  const vals = sh.getRange(2, col + 1, lastRow - 1, 1).getValues();
  ids.forEach(function (r, i) {
    const p = parseStartMonth_(vals[i][0]);
    if (r[0] && p) map[String(r[0]).trim().toUpperCase()] = p;
  });
  return map;
}

// Accepts a date cell, "11/2026", "2026-11", "Nov 2026"
function parseStartMonth_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date && !isNaN(v)) return { y: v.getFullYear(), m: v.getMonth() + 1 };
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m) return { y: +m[2], m: +m[1] };
  m = s.match(/^(\d{4})[\/\-](\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2] };
  const d = new Date(s);
  if (!isNaN(d)) return { y: d.getFullYear(), m: d.getMonth() + 1 };
  return null;
}


// ── First month (1-12) this employee owes in `year`; 13 = none ──
function firstRequiredMonth_(startMap, employeeId, year, config) {
  const goLive = effectiveGoLiveMonth_(config || getConfig(), year);
  const st = startMap[String(employeeId).trim().toUpperCase()];
  if (!st || st.y < year) return goLive;
  if (st.y > year) return 13;
  return Math.max(goLive, st.m);
}


// ── RUN ONCE: adds the column, Go Live Year, and widens Language ──
function setupTrainingStart() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const notes = [];

  // 1. Training_Start_Month column on Employees
  const emp = ss.getSheetByName('Employees');
  const lastCol = emp.getLastColumn();
  const hdr = emp.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  let col = hdr.indexOf(TRAINING_START_HEADER) + 1;
  if (!col) {
    // put it right after the last real header (skip the red note text if present)
    let lastHdr = 0;
    hdr.forEach(function (h, i) { if (/^[A-Za-z_]+$/.test(h)) lastHdr = i + 1; });
    col = lastHdr + 1;
    if (emp.getRange(1, col).getValue() !== '') { emp.insertColumnAfter(lastHdr); }
    emp.getRange(1, col).setValue(TRAINING_START_HEADER)
      .setBackground('#0f2d4a').setFontColor('#f0a500').setFontWeight('bold').setHorizontalAlignment('center');
    emp.setColumnWidth(col, 170);
    notes.push('Added column ' + TRAINING_START_HEADER + ' (col ' + col + ').');
  } else {
    notes.push(TRAINING_START_HEADER + ' column already exists (col ' + col + ').');
  }
  const rows = Math.max(emp.getMaxRows() - 1, 1);
  emp.getRange(2, col, rows, 1)
    .setNumberFormat('mmm yyyy')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
      .setHelpText('First month this employee owes training. Enter like 11/1/2026. Leave blank to start at Go Live.').build());
  emp.getRange(1, col).setNote('First month this employee owes safety training.\nEnter a date like 11/1/2026 (shows as Nov 2026).\nBlank = starts at the Go Live month.\nEarlier months never appear for them.');

  // 2. Widen Language validation to all 5 app languages
  const langCol = hdr.indexOf('Language') + 1;
  if (langCol) {
    emp.getRange(2, langCol, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['EN', 'ES', 'FR', 'RU', 'AR'], true).build());
    notes.push('Language column now allows EN, ES, FR, RU, AR.');
  }

  // 3. Go Live Year in Config
  const cfg = ss.getSheetByName('Config');
  const keys = cfg.getRange(2, 1, Math.max(cfg.getLastRow() - 1, 1), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  if (keys.indexOf('Go Live Year') < 0) {
    const r = cfg.getLastRow() + 1;
    cfg.getRange(r, 1).setValue('Go Live Year').setFontWeight('bold').setBackground('#1a3a52').setFontColor('#f0a500');
    cfg.getRange(r, 2).setValue(new Date().getFullYear()).setBackground('#f9f9f9');
    cfg.getRange(r, 3).setValue('Year the system went live. Go Live Month only hides months in this year; later years start in January.')
      .setFontColor('#666666').setFontStyle('italic');
    notes.push('Added Config "Go Live Year" = ' + new Date().getFullYear() + '. Change it if the portal went live in a different year.');
    if (r > 21) notes.push('WARNING: getConfig() only reads 20 Config rows. Move "Go Live Year" up into rows 2-21.');
  } else {
    notes.push('Config "Go Live Year" already set.');
  }

  ui.alert('Training Start Setup', notes.join('\n\n'), ui.ButtonSet.OK);
}


// ── Editor check: shows each active employee's first required month ──
function debugTrainingStart() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig();
  const yr = new Date().getFullYear();
  const map = getTrainingStartMap_(ss);
  getEmployeeList().forEach(function (e) {
    const f = firstRequiredMonth_(map, e.employeeId, yr, cfg);
    Logger.log(e.employeeId + ' ' + e.displayName + ' -> ' + (f > 12 ? 'nothing owed in ' + yr : 'starts month ' + f));
  });
}
