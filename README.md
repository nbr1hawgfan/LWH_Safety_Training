# LWH Safety Training (PWA)

Monthly safety training, special trainings, and incident reporting for Logistics Warehouse — rebuilt as a GitHub Pages Progressive Web App in the company portal style (red header, black nav, sharp edges, time + weather strip).

**Backend:** the existing Google Sheet + Apps Script. Sheets stay the database; certificates, emails, Drive folders, OSHA log and auto-translation all keep working exactly as before. The new `gas/Api.gs` turns the script into a secured JSON API the PWA calls.

```
index.html              App shell
manifest.webmanifest    PWA manifest (installable, shortcuts to Dashboard / Incidents)
sw.js                   Service worker (offline shell, update prompt)
css/app.css             Portal styling
js/config.js            <-- the only file to edit (API URL, weather location)
js/api.js               API client
js/i18n.js              Employee UI text in EN / ES / FR / RU / AR
js/weather.js           Clock + current temp + today's forecast (Open-Meteo, no key)
js/app.js               Employee sign-in and training flow
js/manager.js           Dashboard, special trainings, incidents, OSHA 300/300A
icons/                  App icons
gas/Api.gs              NEW Apps Script file — add next to Code.gs
```

---

## 1. Apps Script changes (about 10 minutes)

### 1a. Add `Api.gs`
Extensions > Apps Script > **+** > Script > name it `Api` > paste `gas/Api.gs`. Do not paste it into Code.gs.

### 1b. Four small fixes in `Code.gs` (Edit > Find and replace)

These fix a real bug: French, Russian and Arabic employees currently get **Spanish** questions, and their answers are graded against the **English** key, so they can never pass.

| # | Find | Replace with | Count |
|---|------|--------------|-------|
| 1 | `const translated = translateBatch_(flat, 'ES');` | `const translated = translateBatch_(flat, normalizedLang);` | 2 (Replace all) |
| 2 | `language:    useES ? 'ES' : 'EN',` | `language:    normalizedLang,` | 2 (Replace all) |
| 3 | `const lang        = (language === 'ES') ? 'ES' : 'EN';` | `const lang = ['EN','ES','FR','RU','AR'].indexOf(String(language||'').toUpperCase()) >= 0 ? String(language).toUpperCase() : 'EN';` | 1 (in `submitQuiz`) |
| 4 | `const lang = (language === 'ES') ? 'ES' : 'EN';` | same replacement as #3 | 1 (in `submitSpecialQuiz`) |

Optional: in the Employees sheet, widen the Language column validation from `EN,ES` to `EN,ES,FR,RU,AR`.

After saving, translations already cached in the old (wrong) language expire within 1 hour on their own.

### 1c. Deploy
Deploy > **New deployment** > type **Web app**
- Execute as: **Me**
- Who has access: **Anyone**

Copy the `/exec` URL. Run `testApi()` once from the editor to confirm it loads (it should log a ping and the employee count).

> Every later change to Api.gs or Code.gs: Deploy > Manage deployments > edit (pencil) > Version: **New version** > Deploy. The URL stays the same.

---

## 2. GitHub Pages

1. Create a repo (e.g. `LWH-Safety-Training`) and upload everything. The `gas/` folder can stay in the repo as the source of record — the app never loads it.
2. Edit `js/config.js` → paste the `/exec` URL into `API_URL`.
3. Settings > Pages > Deploy from branch > `main` / root.
4. Open `https://nbr1hawgfan.github.io/LWH-Safety-Training/` and use Add to Home Screen.

**Each time you change front-end files:** bump `VERSION` in `sw.js` (and `APP_VERSION` in `config.js`). Installed phones will show an **Update Now** bar.

---

## 3. Cutover — retire the old web app

The old `Index.html` web app lets anyone with its URL call every server function from the browser console (including the incident log with dates of birth and addresses) without a PIN. Once the PWA is live, replace `doGet` in Code.gs with:

```js
function doGet() {
  return ContentService.createTextOutput('The Safety Training Portal has moved. Use the app link from your manager.');
}
```

Returning plain text (not an HTML page) removes the `google.script.run` channel completely. `Index.html` can then be deleted. Triggers (monthly email, reminder, overdue report) are unaffected — update the **Portal URL** in the Config sheet to the GitHub Pages link so emails point to the new app.

---

## What changed vs. the Apps Script version

**Security**
- PIN sign-in issues a session token (6 hours, sliding). Every call checks the token and role; employees can only read and submit their own records.
- 5 wrong PINs for one employee (10 for the manager PIN) = 15-minute cooldown. 4-digit PINs on a public URL need this.
- Correct answers never reach the phone. Answer order is shuffled on the server and grading happens there. (Previously the first option sent to the browser was always the correct one.)
- The video timer is enforced on the server — 90% of the video time must pass between opening a training and submitting.
- The acknowledgment checkbox is required server-side; employees can't resubmit a completed month.
- One manager/HR sign-in covers Dashboard, Special Trainings and Incidents.
- Employee sessions sign out after 15 idle minutes (shared break-room devices); not while the video timer is running.

**Fixes**
- FR / RU / AR language bug (see 1b).
- First failed attempt with an empty Results sheet showed "locked out" (attempts-left came back as NaN).
- OSHA 300A summary now works from the app (old version required the spreadsheet UI) and lets you pick the year; it downloads and also saves to Drive.

**New**
- Reset Lockout buttons on the Dashboard and Special Trainings (failed rows are marked `RESET`, not deleted, so the audit trail stays; logged to Audit_Log).
- Locked Out status + filter on the dashboard.
- Incident form: pick an employee to fill name / ID / warehouse; duplicate-submit warning; Clear Form.
- Special training form accepts a full YouTube link and video length in minutes; validates every question.
- Time, date, current temperature and today's forecast in the top strip (cached for offline).
- Arabic shows right-to-left. Flag emoji removed from language buttons.

**Unchanged**
- Sheet layouts, Config keys, certificates, test records, transcripts, emails, OSHA 300 log, WC Form IA-1 fill (still pdf-lib in the browser), triggers. `generateAllTranscripts()` still runs from the editor.

---

## Known limits
- Apps Script responses take 1–3 seconds; certificate PDFs on a pass take ~10 seconds (same as before).
- The server timer can't prove someone watched the video — only that enough time passed. Same as before, now not bypassable from the browser.
- Translation caching is 1 hour, so edits to a training's questions in the sheet can take up to an hour to show for non-English employees.
