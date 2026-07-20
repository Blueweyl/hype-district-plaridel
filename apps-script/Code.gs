/**
 * SukiDesk backend — Google Apps Script Web App.
 * Deploy this bound to a Google Sheet (Extensions > Apps Script).
 * See SETUP.md for step-by-step instructions.
 *
 * API:
 *   GET  ?action=getAll&token=SECRET        -> { ok: true, db: { staff, clients, bookings, transactions, services } }
 *   POST { action:'saveAll', token, db }    -> { ok: true, savedAt }
 *     (POST body is sent as text/plain to avoid a CORS preflight; this script parses it as JSON.)
 */

const SHEET_NAMES = {
  staff: 'Staff',
  clients: 'Clients',
  bookings: 'Bookings',
  transactions: 'Transactions',
  services: 'Services'
};

const SCHEMAS = {
  staff: ['id', 'name', 'pin', 'role', 'commission_type', 'commission_rate', 'contact_number'],
  clients: ['id', 'name', 'contact_number', 'preferred_stylist', 'notes', 'first_visit_date', 'last_visit_date', 'total_visits'],
  bookings: ['id', 'client_id', 'client_name', 'client_contact', 'requested_stylist_id', 'service', 'source', 'status', 'scheduled_time', 'created_at'],
  transactions: ['id', 'booking_id', 'client_id', 'client_name', 'staff_id', 'staff_name', 'services', 'amount', 'payment_method', 'commission_amount', 'commission_rate_used', 'date'],
  services: ['id', 'name', 'price']
};

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty('SUKIDESK_SECRET') || '';
}

function checkAuth_(token) {
  const secret = getSecret_();
  if (!secret) return true; // no secret configured — open access, not recommended for anything but a quick test
  return token === secret;
}

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function readTab_(key) {
  const headers = SCHEMAS[key];
  const sheet = getOrCreateSheet_(SHEET_NAMES[key], headers);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      if (key === 'transactions' && typeof obj.services === 'string') {
        try { obj.services = JSON.parse(obj.services); } catch (e) { obj.services = []; }
      }
      if (key === 'clients') obj.total_visits = Number(obj.total_visits) || 0;
      if (key === 'staff') obj.commission_rate = Number(obj.commission_rate) || 0;
      if (key === 'services') obj.price = Number(obj.price) || 0;
      if (key === 'transactions') {
        obj.amount = Number(obj.amount) || 0;
        obj.commission_amount = Number(obj.commission_amount) || 0;
      }
      return obj;
    });
}

function writeTab_(key, rows) {
  const headers = SCHEMAS[key];
  const sheet = getOrCreateSheet_(SHEET_NAMES[key], headers);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  if (!rows || !rows.length) return;
  const values = rows.map(obj => headers.map(h => {
    let v = obj[h];
    if (key === 'transactions' && h === 'services') v = JSON.stringify(v || []);
    return v === undefined || v === null ? '' : v;
  }));
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = e.parameter.action;
  const token = e.parameter.token || '';

  if (action === 'getAll') {
    if (!checkAuth_(token)) return jsonOut_({ error: 'unauthorized' });
    const db = {};
    Object.keys(SHEET_NAMES).forEach(key => { db[key] = readTab_(key); });
    return jsonOut_({ ok: true, db: db });
  }
  return jsonOut_({ error: 'unknown action' });
}

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ error: 'invalid json body' });
  }

  if (!checkAuth_(payload.token)) return jsonOut_({ error: 'unauthorized' });

  if (payload.action === 'saveAll') {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
    } catch (err) {
      return jsonOut_({ error: 'busy, try again' });
    }
    try {
      const db = payload.db || {};
      Object.keys(SHEET_NAMES).forEach(key => {
        if (db[key]) writeTab_(key, db[key]);
      });
      return jsonOut_({ ok: true, savedAt: new Date().toISOString() });
    } finally {
      lock.releaseLock();
    }
  }
  return jsonOut_({ error: 'unknown action' });
}
