// ============================================================
// LWH Safety Training — configuration
// The only file you should need to edit after deploying.
// ============================================================
window.LWH_CONFIG = {
  // Apps Script web app /exec URL (Deploy > Manage deployments > Web app URL)
  API_URL: 'https://script.google.com/macros/s/AKfycbxY_tZyajeHo00TH_EWaFgHBhG-fOWN8uxeXwxufDBzVnA8cOZxCdDtkdJ7N_O0uKfK/exec',

  APP_VERSION: '1.0.0',
  COMPANY: 'Logistics Warehouse',

  // Weather shown in the top strip (Open-Meteo, no API key needed)
  WEATHER: {
    label: 'Fort Smith, AR',
    lat: 35.3859,
    lon: -94.3985,
    timezone: 'America/Chicago',
    refreshMinutes: 15,
  },

  // Employee session signs out after this many idle minutes (shared devices)
  EMP_IDLE_MINUTES: 15,

  // Incident form: employer block printed on Form IA-1
  EMPLOYER: {
    nameAddress: 'Logistics Warehouse Inc\n3601 Old Greenwood Rd\nFort Smith, AR 72903',
    phone: '(479) 484-5600',
    state: 'AR',
  },
};
