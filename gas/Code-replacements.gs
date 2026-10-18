// ============================================================
// CODE.GS REPLACEMENTS — 4 functions (language fix for FR/RU/AR)
// ============================================================
// In Code.gs, delete each of these four functions completely and
// paste the matching version below in its place:
//   1. getTrainingData
//   2. submitQuiz
//   3. getSpecialTrainingData
//   4. submitSpecialQuiz
// Nothing else in Code.gs changes. Changed lines are marked // FIX.
// ============================================================

function getTrainingData(lang, monthNum) {
  try {
    const mn     = parseInt(monthNum) || getCurrentMonthNum();
    const normalizedLang = ['EN','ES','FR','RU','AR'].indexOf(String(lang||'EN').toUpperCase()) >= 0 ? String(lang).toUpperCase() : 'EN';
    const useES  = (normalizedLang !== 'EN');  // true for any non-English
    const cacheKey = 'tdata_' + mn + '_' + normalizedLang;

    return getTranslatedTrainingCache_(cacheKey, function() {
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName('Trainings');
      // Read only 31 columns — all English, no Spanish columns needed
      const data  = sheet.getRange(2, 1, 12, 31).getValues();
      const row   = data.find(r => parseInt(r[0]) === mn);
      if (!row) return { error: 'Training not found for month ' + mn };

      const base = 4; // 0-indexed column of first question

      // Collect all English strings into a flat array for batch translation
      const rawQ = [];
      for (let q = 0; q < 5; q++) {
        const b = base + (q * 5);
        if (!row[b]) continue;
        rawQ.push({
          qText:   String(row[b]   || '').trim(),
          correct: String(row[b+1] || '').trim(),
          optB:    String(row[b+2] || '').trim(),
          optC:    String(row[b+3] || '').trim(),
          optD:    String(row[b+4] || '').trim(),
        });
      }

      let desc = String(row[30] || '').trim();

      // One batch translate call covers description + all question text
      if (useES && rawQ.length > 0) {
        const flat = [desc, ...rawQ.flatMap(q => [q.qText, q.correct, q.optB, q.optC, q.optD])];
        const translated = translateBatch_(flat, normalizedLang);  // FIX
        desc = translated[0];
        let idx = 1;
        rawQ.forEach(q => {
          q.qText   = translated[idx++];
          q.correct = translated[idx++];
          q.optB    = translated[idx++];
          q.optC    = translated[idx++];
          q.optD    = translated[idx++];
        });
      }

      const questions = rawQ.map(q => ({
        q:             q.qText,
        options:       [q.correct, q.optB, q.optC, q.optD],
        correctAnswer: q.correct,
      }));

      return {
        monthNum:    mn,
        monthName:   row[1],
        topic:       row[2],
        videoId:     row[3],
        questions:   questions,
        durationSec: parseInt(row[29]) || 240,
        description: desc,
        language:    normalizedLang,  // FIX
      };
    });
  } catch(e) {
    return { error: e.toString() };
  }
}


function submitQuiz(employeeId, answers, acknowledged, language, monthNumParam) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lang = ['EN','ES','FR','RU','AR'].indexOf(String(language||'').toUpperCase()) >= 0 ? String(language).toUpperCase() : 'EN';  // FIX
    const targetMonth = (parseInt(monthNumParam) >= 1 && parseInt(monthNumParam) <= 12)
      ? parseInt(monthNumParam) : getCurrentMonthNum();
    const training = getTrainingData(lang, targetMonth);
    if (training.error) return { success: false, message: training.error };
    const monthNum = training.monthNum;

    const lockout = checkLockout_(ss, employeeId, monthNum);
    if (lockout.locked) {
      return { success: false, message: 'You have been locked out after 5 failed attempts. Please contact your manager.' };
    }

    let correct = 0;
    const answersWithQuestions = [];
    answers.forEach((submittedText, i) => {
      const q = training.questions[i];
      if (!q) return;
      const isCorrect = String(submittedText).trim() === String(q.correctAnswer).trim();
      if (isCorrect) correct++;
      answersWithQuestions.push({ question: q.q, answer: submittedText, correct: isCorrect });
    });
    const scorePct = Math.round((correct / training.questions.length) * 100);
    const passed   = scorePct === 100;

    const empSheet = ss.getSheetByName('Employees');
    const empData  = empSheet.getRange(2, 1, empSheet.getLastRow() - 1, 11).getValues();
    const empRow   = empData.find(r => String(r[0]).trim().toUpperCase() === String(employeeId).trim().toUpperCase());
    const firstName    = empRow ? empRow[1] : '';
    const lastName     = empRow ? empRow[2] : '';
    const warehouse    = empRow ? empRow[5] : '';
    const empEmail     = empRow ? empRow[4] : '';
    const managerName  = empRow ? (empRow[8]  || '') : '';
    const managerEmail = empRow ? (empRow[9]  || '') : '';

    const resultsSheet = ss.getSheetByName('Results');
    const currentYear  = new Date().getFullYear();
    let attemptNum = 1;
    if (resultsSheet.getLastRow() > 1) {
      const prev  = resultsSheet.getRange(2, 1, resultsSheet.getLastRow() - 1, 16).getValues();
      const prior = prev.filter(r =>
        String(r[1]).trim().toUpperCase() === String(employeeId).trim().toUpperCase() &&
        parseInt(r[5]) === monthNum &&
        parseInt(r[15]) === currentYear
      );
      attemptNum = prior.length + 1;
    }

    const config      = getConfig();
    const deadlineDay = parseInt(config['Deadline Day']) || 15;
    const today       = new Date();
    const onTime      = today.getDate() <= deadlineDay;
    const ts          = new Date();
    const ackTs       = acknowledged ? ts : '';

    resultsSheet.appendRow([
      ts, employeeId, firstName, lastName, warehouse,
      monthNum, training.monthName, training.topic,
      scorePct, passed ? 'TRUE' : 'FALSE',
      attemptNum, onTime ? 'TRUE' : 'FALSE',
      acknowledged ? 'TRUE' : 'FALSE',
      ackTs,
      lang,
      currentYear,
    ]);

    if (!passed) {
      const newLockout = checkLockout_(ss, employeeId, monthNum);
      if (newLockout.locked && managerEmail) {
        sendLockoutNotification_(firstName, lastName, employeeId, warehouse, training, managerEmail, managerName);
      }
    }

    if (passed) {
      let certBlob       = null;
      let testRecordBlob = null;
      const company = config['Company Name'] || 'Logistics Warehouse';

      try {
        certBlob = generateCertificate_(firstName, lastName, training, ts, company, managerName);
      } catch(certErr) {
        Logger.log('Certificate FAILED: ' + certErr.toString());
      }

      try {
        testRecordBlob = generateTestRecord_(
          firstName, lastName, employeeId, warehouse, training,
          ts, onTime, acknowledged, lang, attemptNum,
          answersWithQuestions, company, managerName
        );
      } catch(trErr) {
        Logger.log('Test record FAILED: ' + trErr.toString());
      }

      sendCompletionEmail_(config, empEmail, firstName, lastName, training, ts, onTime, answersWithQuestions, certBlob, managerName);
      logHrCompletion_(config, firstName, lastName, employeeId, warehouse, training, ts, onTime, answersWithQuestions, certBlob, managerName, managerEmail);
    }

    logAudit_(ss, employeeId,
      passed ? 'QUIZ_PASS' : 'QUIZ_FAIL',
      'Score: ' + scorePct + '% | Attempt: ' + attemptNum + ' | Month: ' + training.monthName + ' | Lang: ' + lang + ' | Ack: ' + (acknowledged?'YES':'NO')
    );

    return {
      success: true, passed, score: scorePct,
      correct, total: training.questions.length,
      attempt: attemptNum, onTime,
      attemptsLeft: passed ? 5 : Math.max(0, 5 - (lockout.failCount + 1)),
    };
  } catch(e) {
    return { success: false, message: 'Error submitting quiz: ' + e.toString() };
  }
}


function getSpecialTrainingData(trainingId, lang) {
  try {
    const normalizedLang = ['EN','ES','FR','RU','AR'].indexOf(String(lang||'EN').toUpperCase()) >= 0 ? String(lang).toUpperCase() : 'EN';
    const useES    = (normalizedLang !== 'EN');
    const cacheKey = 'st_' + trainingId + '_' + normalizedLang;

    return getTranslatedTrainingCache_(cacheKey, function() {
      const ss      = SpreadsheetApp.getActiveSpreadsheet();
      const stSheet = ss.getSheetByName('Special_Trainings');
      if (!stSheet || stSheet.getLastRow() < 2) return { error: 'Special_Trainings sheet not found.' };

      // Read only English columns (first 36)
      const data = stSheet.getRange(2, 1, stSheet.getLastRow()-1, 36).getValues();
      const row  = data.find(r => String(r[0]).trim() === String(trainingId).trim());
      if (!row) return { error: 'Training ' + trainingId + ' not found.' };

      const base = 11; // 0-indexed column of first question (col L)

      const rawQ = [];
      for (let q = 0; q < 5; q++) {
        const b = base + (q * 5);
        if (!row[b]) continue;
        rawQ.push({
          qText:   String(row[b]   || '').trim(),
          correct: String(row[b+1] || '').trim(),
          optB:    String(row[b+2] || '').trim(),
          optC:    String(row[b+3] || '').trim(),
          optD:    String(row[b+4] || '').trim(),
        });
      }

      let title = String(row[1] || '').trim();
      let desc  = String(row[2] || '').trim();

      if (useES && rawQ.length > 0) {
        const flat = [title, desc, ...rawQ.flatMap(q => [q.qText, q.correct, q.optB, q.optC, q.optD])];
        const translated = translateBatch_(flat, normalizedLang);  // FIX
        title = translated[0];
        desc  = translated[1];
        let idx = 2;
        rawQ.forEach(q => {
          q.qText   = translated[idx++];
          q.correct = translated[idx++];
          q.optB    = translated[idx++];
          q.optC    = translated[idx++];
          q.optD    = translated[idx++];
        });
      }

      const questions = rawQ.map(q => ({
        q:             q.qText,
        options:       [q.correct, q.optB, q.optC, q.optD],
        correctAnswer: q.correct,
      }));

      return {
        trainingId:  row[0],
        title:       title,
        description: desc,
        videoId:     row[3],
        durationSec: parseInt(row[4]) || 300,
        assignedBy:  row[7],
        deadline:    row[9] ? String(row[9]) : '',
        questions:   questions,
        language:    normalizedLang,  // FIX
      };
    });
  } catch(e) {
    return { error: e.toString() };
  }
}


function submitSpecialQuiz(employeeId, trainingId, answers, acknowledged, language) {
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const lang = ['EN','ES','FR','RU','AR'].indexOf(String(language||'').toUpperCase()) >= 0 ? String(language).toUpperCase() : 'EN';  // FIX

    const training = getSpecialTrainingData(trainingId, lang);
    if (training.error) return { success: false, message: training.error };

    const lockout = checkSpecialLockout_(ss, employeeId, trainingId);
    if (lockout.locked) return { success: false, message: 'You have been locked out after 5 failed attempts. Please contact your manager.' };

    let correct = 0;
    const answersWithQuestions = [];
    answers.forEach(function(submittedText, i) {
      const q = training.questions[i];
      if (!q) return;
      const isCorrect = String(submittedText).trim() === String(q.correctAnswer).trim();
      if (isCorrect) correct++;
      answersWithQuestions.push({ question: q.q, answer: submittedText, correct: isCorrect });
    });
    const scorePct = Math.round((correct / training.questions.length) * 100);
    const passed   = scorePct === 100;

    const empSheet = ss.getSheetByName('Employees');
    const empData  = empSheet.getRange(2,1,empSheet.getLastRow()-1,empSheet.getLastColumn()).getValues();
    const empRow   = empData.find(r => String(r[0]).trim().toUpperCase() === String(employeeId).trim().toUpperCase());
    const firstName    = empRow ? empRow[1] : '';
    const lastName     = empRow ? empRow[2] : '';
    const warehouse    = empRow ? empRow[5] : '';
    const empEmail     = empRow ? empRow[4] : '';
    const managerName  = empRow ? (empRow[8]  || '') : '';
    const managerEmail = empRow ? (empRow[9]  || '') : '';

    const srSheet = ss.getSheetByName('Special_Results');
    let attemptNum = 1;
    if (srSheet.getLastRow() > 1) {
      const prev = srSheet.getRange(2,1,srSheet.getLastRow()-1,6).getValues();
      attemptNum = prev.filter(r =>
        String(r[1]).trim().toUpperCase() === String(employeeId).trim().toUpperCase() &&
        String(r[5]).trim() === String(trainingId).trim()
      ).length + 1;
    }

    let onTime = true;
    if (training.deadline) {
      try { onTime = new Date() <= new Date(training.deadline); } catch(e) {}
    }

    const ts          = new Date();
    const currentYear = ts.getFullYear();
    const ackTs       = acknowledged ? ts : '';

    srSheet.appendRow([
      ts, employeeId, firstName, lastName, warehouse,
      trainingId, training.title,
      scorePct, passed ? 'TRUE' : 'FALSE',
      attemptNum, onTime ? 'TRUE' : 'FALSE',
      acknowledged ? 'TRUE' : 'FALSE', ackTs,
      lang, currentYear,
    ]);

    if (!passed) {
      const newLockout = checkSpecialLockout_(ss, employeeId, trainingId);
      if (newLockout.locked && managerEmail) {
        sendSpecialLockoutNotification_(firstName, lastName, employeeId, warehouse, training, managerEmail, managerName);
      }
    }

    if (passed) {
      const config  = getConfig();
      const company = config['Company Name'] || 'Logistics Warehouse';

      let certBlob = null, recBlob = null;
      try {
        certBlob = generateSpecialCertificate_(firstName, lastName, training, ts, company, managerName);
      } catch(e) { Logger.log('Special cert FAILED: ' + e.toString()); }

      try {
        recBlob = generateSpecialTestRecord_(
          firstName, lastName, employeeId, warehouse, training,
          ts, onTime, acknowledged, lang, attemptNum,
          answersWithQuestions, company, managerName
        );
      } catch(e) { Logger.log('Special record FAILED: ' + e.toString()); }

      sendSpecialCompletionEmails_(
        config, empEmail, firstName, lastName, employeeId, warehouse,
        training, ts, onTime, answersWithQuestions, certBlob, recBlob,
        managerName, managerEmail
      );
    }

    logAudit_(ss, employeeId,
      passed ? 'SPECIAL_PASS' : 'SPECIAL_FAIL',
      'Training: ' + training.title + ' (' + trainingId + ') | Score: ' + scorePct + '% | Attempt: ' + attemptNum
    );

    return {
      success: true, passed, score: scorePct,
      correct, total: training.questions.length,
      attempt: attemptNum, onTime,
      attemptsLeft: passed ? 5 : Math.max(0, (lockout.failCount||0) + 1 >= 5 ? 0 : 5 - ((lockout.failCount||0)+1)),
    };
  } catch(e) {
    Logger.log('submitSpecialQuiz error: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}
