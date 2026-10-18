// ============================================================
// CODE.GS REPLACEMENTS #2 — Training Start Month + Go Live Year
// ============================================================
// Requires the new file TrainingStart.gs (add it first).
// In Code.gs, delete each of these six functions completely and
// paste the matching version below in its place:
//   1. getMonthStatus
//   2. getDashboardDataForMonth
//   3. sendMonthlyAnnouncementEmail
//   4. sendReminderEmails
//   5. getAnnualTranscript
//   6. generateTranscriptPDF
// Changed lines are marked // FIX. In generateTranscriptPDF the two
// "of 12" lines now say "of N required" (not marked, mid-string).
// ============================================================

function getMonthStatus(employeeId, lang) {
  try {
    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const currentMon  = getCurrentMonthNum();
    const config      = getConfig();
    const deadlineDay = parseInt(config['Deadline Day']) || 15;
    const goLiveMon   = effectiveGoLiveMonth_(config, new Date().getFullYear());  // FIX
    const today       = new Date();
    const todayDay    = today.getDate();

    const tSheet = ss.getSheetByName('Trainings');
    const tData  = tSheet.getRange(2, 1, 12, 4).getValues();

    const rSheet = ss.getSheetByName('Results');
    const year   = new Date().getFullYear();
    const firstReq = firstRequiredMonth_(getTrainingStartMap_(ss), employeeId, year, config);  // FIX
    let results  = [];
    if (rSheet.getLastRow() > 1) {
      results = rSheet.getRange(2, 1, rSheet.getLastRow()-1, 16).getValues()
        .filter(r =>
          String(r[1]).trim().toUpperCase() === String(employeeId).trim().toUpperCase() &&
          (r[15] === '' || parseInt(r[15]) === year || isNaN(parseInt(r[15])))
        );
    }

    const months = [];
    let allPriorComplete = true;

    for (let i = 0; i < tData.length; i++) {
      const mn    = parseInt(tData[i][0]);
      const mName = tData[i][1];
      const topic = tData[i][2];

      if (mn < firstReq) continue;  // FIX
      if (mn > currentMon) break;

      const passRow  = results.find(r => parseInt(r[5]) === mn && String(r[9]).trim().toUpperCase() === 'TRUE');
      const attempts = results.filter(r => parseInt(r[5]) === mn).length;
      const lockout  = checkLockout_(ss, employeeId, mn);

      let status;
      let completedAt = '';
      let canTake = false;

      if (passRow) {
        status = 'complete';
        try {
          completedAt = Utilities.formatDate(
            new Date(passRow[0]), Session.getScriptTimeZone(), 'MM/dd/yyyy');
        } catch(e) {}
      } else if (lockout.locked) {
        status  = 'locked';
        canTake = false;
      } else if (allPriorComplete) {
        status           = mn === currentMon ? 'current' : 'makeup';
        canTake          = true;
        allPriorComplete = false;
      } else {
        status  = mn === currentMon ? 'current-blocked' : 'makeup-blocked';
        canTake = false;
      }

      const isPastDeadline = (mn < currentMon) || (mn === currentMon && todayDay > deadlineDay);

      months.push({
        monthNum:       mn,
        monthName:      mName,
        topic:          topic,
        status:         status,
        canTake:        canTake,
        completedAt:    completedAt,
        attempts:       attempts,
        attemptsLeft:   lockout.attemptsLeft,
        isPastDeadline: isPastDeadline,
        isCurrent:      mn === currentMon,
      });
    }

    return { success: true, months: months, currentMonth: currentMon, goLiveMonth: goLiveMon };
  } catch(e) {
    Logger.log('getMonthStatus error: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}


function getDashboardDataForMonth(monthNum, year) {
  try {
    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const config      = getConfig();
    const deadlineDay = parseInt(config['Deadline Day']) || 15;
    const filterYear  = parseInt(year) || new Date().getFullYear();

    const tSheet = ss.getSheetByName('Trainings');
    const tData  = tSheet.getRange(2, 1, 12, 4).getValues();
    const tRow   = tData.find(r => parseInt(r[0]) === monthNum);
    const monthName = tRow ? tRow[1] : 'Month ' + monthNum;
    const topic     = tRow ? tRow[2] : 'Unknown';

    const startMap = getTrainingStartMap_(ss);  // FIX
    const empSheet = ss.getSheetByName('Employees');
    const lastEmpCol = empSheet.getLastColumn();
    const empData  = empSheet.getRange(2, 1, Math.max(empSheet.getLastRow()-1,1), lastEmpCol).getValues()
      .filter(r => {
        const active = r[7];
        return r[0] && ((active === true) || (String(active).trim().toUpperCase() === 'TRUE')) &&
          firstRequiredMonth_(startMap, r[0], filterYear, config) <= monthNum;  // FIX
      });

    const resSheet = ss.getSheetByName('Results');
    let results = [];
    if (resSheet.getLastRow() > 1) {
      results = resSheet.getRange(2, 1, resSheet.getLastRow()-1, 16).getValues()
        .filter(r =>
          parseInt(r[5]) === monthNum &&
          (r[15] === '' || parseInt(r[15]) === filterYear || isNaN(parseInt(r[15])))
        );
    }

    const today        = new Date();
    const pastDeadline = (monthNum < new Date().getMonth()+1 && filterYear <= new Date().getFullYear()) ||
                         (today.getDate() > deadlineDay && monthNum === new Date().getMonth()+1 && filterYear === new Date().getFullYear());

    const rows = empData.map(emp => {
      const empId    = String(emp[0]).trim().toUpperCase();
      const empRes   = results.filter(r => String(r[1]).trim().toUpperCase() === empId);
      const passRow  = empRes.find(r => String(r[9]).trim().toUpperCase() === 'TRUE');
      const attempts = empRes.length;
      let status = 'Not Started', completedAt = '', onTime = '';
      if (passRow) {
        status      = String(passRow[11]).trim().toUpperCase() === 'TRUE' ? 'Complete (On Time)' : 'Complete (Late)';
        completedAt = passRow[0] ? Utilities.formatDate(new Date(passRow[0]), Session.getScriptTimeZone(), 'MM/dd/yyyy h:mm a') : '';
        onTime      = String(passRow[11]).trim().toUpperCase() === 'TRUE' ? 'Yes' : 'No';
      } else if (attempts > 0) {
        status = 'In Progress';
      }
      return { employeeId:emp[0], name:emp[1]+' '+emp[2], warehouse:emp[5], department:emp[6], status, completedAt, onTime, attempts };
    });

    const total      = rows.length;
    const complete   = rows.filter(r => r.status.startsWith('Complete')).length;
    const onTimeCount= rows.filter(r => r.onTime === 'Yes').length;
    const incomplete = rows.filter(r => !r.status.startsWith('Complete')).length;

    return {
      success: true, monthNum, monthName, topic, deadlineDay, pastDeadline,
      year: filterYear,
      today: Utilities.formatDate(today, Session.getScriptTimeZone(), 'MM/dd/yyyy'),
      stats: { total, complete, onTimeCount, incomplete },
      rows,
    };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}


function sendMonthlyAnnouncementEmail() {
  const config   = getConfig();
  if (String(config['Send Month Email']).trim().toUpperCase() !== 'TRUE') return;

  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const training = getTrainingData('EN');
  if (training.error) { Logger.log('Training error: ' + training.error); return; }

  const startMap = getTrainingStartMap_(ss);  // FIX
  const empSheet = ss.getSheetByName('Employees');
  const empData  = empSheet.getRange(2, 1, Math.max(empSheet.getLastRow()-1,1), 8).getValues()
    .filter(r => r[0] && r[4] && ((r[7] === true) || (String(r[7]).trim().toUpperCase() === 'TRUE')))
    .filter(r => firstRequiredMonth_(startMap, r[0], new Date().getFullYear(), config) <= getCurrentMonthNum());  // FIX

  const portalUrl   = config['Portal URL'];
  const company     = config['Company Name'] || 'Logistics Warehouse';
  const deadlineDay = config['Deadline Day'] || '15';

  empData.forEach(emp => {
    const email = String(emp[4]).trim();
    if (!email || !email.includes('@')) return;
    const firstName = emp[1];

    const subject = company + ' Safety Training — ' + training.monthName + ': ' + training.topic;
    const body = buildAnnouncementHtml_(firstName, training, portalUrl, deadlineDay, company);

    MailApp.sendEmail({ to: email, subject: subject, htmlBody: body });
  });

  Logger.log('Monthly announcement sent to ' + empData.length + ' employees.');
}


function sendReminderEmails() {
  const config = getConfig();
  if (String(config['Send Reminder']).trim().toUpperCase() !== 'TRUE') return;

  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const monthNum = getCurrentMonthNum();
  const training = getTrainingData('EN');
  if (training.error) return;

  const startMap = getTrainingStartMap_(ss);  // FIX
  const empSheet = ss.getSheetByName('Employees');
  const empData  = empSheet.getRange(2, 1, Math.max(empSheet.getLastRow()-1,1), 8).getValues()
    .filter(r => r[0] && r[4] && ((r[7] === true) || (String(r[7]).trim().toUpperCase() === 'TRUE')))
    .filter(r => firstRequiredMonth_(startMap, r[0], new Date().getFullYear(), config) <= monthNum);  // FIX

  const resSheet = ss.getSheetByName('Results');
  let completedIds = [];
  if (resSheet.getLastRow() > 1) {
    completedIds = resSheet.getRange(2, 1, resSheet.getLastRow()-1, 10).getValues()
      .filter(r => parseInt(r[5]) === monthNum && String(r[9]).trim().toUpperCase() === 'TRUE')
      .map(r => String(r[1]).trim().toUpperCase());
  }

  const portalUrl   = config['Portal URL'];
  const company     = config['Company Name'] || 'Logistics Warehouse';
  const deadlineDay = config['Deadline Day'] || '15';

  empData.forEach(emp => {
    const empId = String(emp[0]).trim().toUpperCase();
    if (completedIds.includes(empId)) return;
    const email = String(emp[4]).trim();
    if (!email || !email.includes('@')) return;

    const subject = 'REMINDER: ' + training.monthName + ' Safety Training Due ' + deadlineDay + getOrdinal_(deadlineDay);
    const body = buildReminderHtml_(emp[1], training, portalUrl, deadlineDay, company);
    MailApp.sendEmail({ to: email, subject: subject, htmlBody: body });
  });
}


function getAnnualTranscript(employeeId) {
  try {
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const empSheet = ss.getSheetByName('Employees');
    const empData  = empSheet.getRange(2, 1, empSheet.getLastRow()-1, 11).getValues();
    const empRow   = empData.find(r => String(r[0]).trim().toUpperCase() === String(employeeId).trim().toUpperCase());
    if (!empRow) return { success: false, message: 'Employee not found.' };

    const year     = new Date().getFullYear();  // FIX
    const firstReq = firstRequiredMonth_(getTrainingStartMap_(ss), employeeId, year, getConfig());  // FIX
    const resSheet = ss.getSheetByName('Results');
    let results = [];
    if (resSheet.getLastRow() > 1) {
      results = resSheet.getRange(2, 1, resSheet.getLastRow()-1, 16).getValues()  // FIX
        .filter(r => String(r[1]).trim().toUpperCase() === String(employeeId).trim().toUpperCase() &&
          (r[15] === '' || isNaN(parseInt(r[15])) || parseInt(r[15]) === year));  // FIX only this year's results
    }

    const tSheet    = ss.getSheetByName('Trainings');
    const trainings = tSheet.getRange(2, 1, 12, 4).getValues();
    const months    = trainings.map(t => {
      const monthRes    = results.filter(r => parseInt(r[5]) === parseInt(t[0]));
      const passRow     = monthRes.find(r => String(r[9]).trim().toUpperCase() === 'TRUE');
      const attempts    = monthRes.length;
      const acknowledged = passRow ? String(passRow[12]).trim().toUpperCase() === 'TRUE' : false;
      return {
        monthNum:     parseInt(t[0]),
        monthName:    t[1],
        topic:        t[2],
        status:       passRow ? 'Complete' : (parseInt(t[0]) < firstReq ? 'Not Required' : (attempts > 0 ? 'Incomplete' : 'Not Started')),  // FIX
        completedAt:  passRow && passRow[0] ? Utilities.formatDate(new Date(passRow[0]), Session.getScriptTimeZone(), 'MM/dd/yyyy h:mm a') : '',
        onTime:       passRow ? (String(passRow[11]).trim().toUpperCase() === 'TRUE' ? 'Yes' : 'No') : '',
        attempts:     attempts,
        acknowledged: acknowledged ? 'Yes' : (passRow ? 'No' : ''),
      };
    });

    return {
      success: true,
      employee: {
        id:          empRow[0],
        name:        empRow[1] + ' ' + empRow[2],
        warehouse:   empRow[5],
        department:  empRow[6],
        manager:     empRow[8] || '',
      },
      year:   new Date().getFullYear(),
      months: months,
      requiredCount: months.filter(function(m){ return m.status !== 'Not Required'; }).length,  // FIX
    };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}


function generateTranscriptPDF(employeeId) {
  try {
    const data    = getAnnualTranscript(employeeId);
    if (!data.success) return { success: false, message: data.message };
    const config  = getConfig();
    const company = config['Company Name'] || 'Logistics Warehouse';
    const emp     = data.employee;
    const year    = data.year;

    const doc  = DocumentApp.create('TRANSCRIPT_TEMP_' + emp.id + '_' + Date.now());
    const body = doc.getBody();
    body.setPageWidth(612); body.setPageHeight(792);
    body.setMarginTop(54); body.setMarginBottom(54);
    body.setMarginLeft(54); body.setMarginRight(54);

    function addP(text, size, bold, color, spB, spA, align) {
      const p = body.appendParagraph(text);
      const s = {};
      s[DocumentApp.Attribute.FONT_SIZE]        = size;
      s[DocumentApp.Attribute.BOLD]             = bold;
      s[DocumentApp.Attribute.FOREGROUND_COLOR] = color;
      s[DocumentApp.Attribute.SPACING_BEFORE]   = spB;
      s[DocumentApp.Attribute.SPACING_AFTER]    = spA;
      s[DocumentApp.Attribute.FONT_FAMILY]      = 'Arial';
      s[DocumentApp.Attribute.HORIZONTAL_ALIGNMENT] = align || DocumentApp.HorizontalAlignment.LEFT;
      p.setAttributes(s);
      return p;
    }

    addP(company.toUpperCase(), 18, true, '#0f2d4a', 0, 2, DocumentApp.HorizontalAlignment.CENTER);
    addP('ANNUAL SAFETY TRAINING TRANSCRIPT — ' + year, 11, true, '#888888', 0, 4, DocumentApp.HorizontalAlignment.CENTER);
    addP('━'.repeat(72), 10, true, '#f0a500', 0, 14, DocumentApp.HorizontalAlignment.CENTER);
    addP('Employee Information', 12, true, '#0f2d4a', 0, 6);
    addP('Name:          ' + emp.name, 11, false, '#333333', 0, 3);
    addP('Employee ID:   ' + emp.id,   11, false, '#333333', 0, 3);
    addP('Warehouse:     ' + emp.warehouse, 11, false, '#333333', 0, 3);
    addP('Department:    ' + emp.department, 11, false, '#333333', 0, 3);
    addP('Manager:       ' + (emp.manager || 'Not assigned'), 11, false, '#333333', 0, 3);
    addP('Report Date:   ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy'), 11, false, '#333333', 0, 14);

    addP('Training Completion Record', 12, true, '#0f2d4a', 0, 6);
    addP('━'.repeat(72), 10, true, '#f0a500', 0, 8, DocumentApp.HorizontalAlignment.CENTER);

    const table = body.appendTable();
    const hRow  = table.appendTableRow();
    ['Month','Topic','Status','Completed','On Time','Attempts','Acknowledged'].forEach(function(h) {
      const cell = hRow.appendTableCell(h);
      cell.setBackgroundColor('#0f2d4a');
      cell.getChild(0).asText().setBold(true).setForegroundColor('#f0a500');
      cell.setPaddingTop(5); cell.setPaddingBottom(5);
      cell.setPaddingLeft(6); cell.setPaddingRight(6);
    });

    data.months.forEach(function(m) {
      const row = table.appendTableRow();
      const statusColor = m.status === 'Complete' ? '#1e7e34' : (m.status === 'Not Required' ? '#888888' : (m.status === 'Not Started' ? '#9b1c1c' : '#7c5800'));  // FIX
      [m.monthName, m.topic, m.status, m.completedAt||'—', m.onTime||'—', String(m.attempts), m.acknowledged||'—'].forEach(function(val, ci) {
        const cell = row.appendTableCell(val);
        cell.setPaddingTop(4); cell.setPaddingBottom(4);
        cell.setPaddingLeft(6); cell.setPaddingRight(6);
        if (ci === 2) cell.getChild(0).asText().setForegroundColor(statusColor).setBold(true);
      });
    });

    const complete = data.months.filter(function(m){ return m.status === 'Complete'; }).length;
    const onTimeCt = data.months.filter(function(m){ return m.onTime === 'Yes'; }).length;
    addP('━'.repeat(72), 10, true, '#f0a500', 14, 8, DocumentApp.HorizontalAlignment.CENTER);
    addP('Summary: ' + complete + ' of ' + data.requiredCount + ' required trainings completed  |  ' + onTimeCt + ' completed on time', 11, false, '#333333', 0, 4, DocumentApp.HorizontalAlignment.CENTER);
    addP('This transcript was generated automatically by the ' + company + ' Safety Training Portal.', 10, false, '#888888', 8, 0, DocumentApp.HorizontalAlignment.CENTER);

    doc.saveAndClose();

    const docFile   = DriveApp.getFileById(doc.getId());
    const exportUrl = 'https://docs.google.com/document/d/' + doc.getId() + '/export?format=pdf';
    const token     = ScriptApp.getOAuthToken();
    const response  = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    docFile.setTrashed(true);

    const safeName  = emp.name.replace(/[^a-zA-Z0-9]/g,'_');
    const pdfName   = safeName + '_Safety_Transcript_' + year + '.pdf';
    const pdfBlob   = response.getBlob().setName(pdfName);

    try {
      const cfg        = getConfig();
      const rootId     = cfg['Certificates Folder ID'];
      const rootFolder = (rootId && rootId !== 'PASTE_FOLDER_ID_HERE')
        ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();
      const txFolderIter = rootFolder.getFoldersByName('Transcripts_' + year);
      const txFolder     = txFolderIter.hasNext()
        ? txFolderIter.next() : rootFolder.createFolder('Transcripts_' + year);
      const old = txFolder.getFilesByName(pdfName);
      if (old.hasNext()) old.next().setTrashed(true);
      txFolder.createFile(pdfBlob.copyBlob());
    } catch(e) {
      Logger.log('Transcript Drive save error: ' + e.toString());
    }

    const hrEmail  = config['HR Email'] || '';
    const mgrs     = config['Manager Emails'] || '';
    const allTo    = [hrEmail, ...mgrs.split(',')].map(e=>e.trim()).filter(e=>e.includes('@')).join(',');
    if (allTo) {
      const subject = company + ' — Annual Safety Transcript: ' + emp.name + ' (' + year + ')';
      const emailBody =
        '<div style="font-family:Arial,sans-serif;max-width:560px;">' +
        '<div style="background:#0f2d4a;padding:16px;">' +
        '<h3 style="color:#f0a500;margin:0;">Annual Training Transcript</h3>' +
        '</div><div style="padding:20px;background:#fff;border:1px solid #ddd;">' +
        '<p style="font-size:14px;color:#333;">Please find attached the ' + year + ' annual safety training transcript for <strong>' + emp.name + '</strong>.</p>' +
        '<p style="font-size:13px;color:#555;">Completed: <strong>' + complete + ' of ' + data.requiredCount + '</strong> required trainings | On Time: <strong>' + onTimeCt + '</strong></p>' +
        '</div></div>';
      try {
        MailApp.sendEmail({ to: allTo, subject: subject, htmlBody: emailBody, name: company, attachments: [pdfBlob] });
      } catch(e) {
        Logger.log('Transcript email error: ' + e.toString());
      }
    }

    return { success: true, name: emp.name, complete: complete, required: data.requiredCount, pdfName: pdfName };  // FIX
  } catch(e) {
    Logger.log('generateTranscriptPDF error: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}
