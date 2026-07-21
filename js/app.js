/* ===== SukiDesk — app data layer + views ===== */
/* localStorage is the always-on local cache (offline-tolerant). When a Google
   Sheets Web App URL is configured in Settings, it also syncs: pulls latest on
   login, pushes a few seconds after any change. See apps-script/SETUP.md. */

const DB_KEY = 'sukidesk_db_v1';
const SESSION_KEY = 'sukidesk_session_v1';

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function seedDB() {
  const db = {
    staff: [
      { id: uid('stf'), name: 'Owner', pin: '1234', role: 'owner', commission_type: 'fixed', commission_rate: 0, contact_number: '' }
    ],
    clients: [],
    bookings: [],
    transactions: [],
    services: [
      'Classic Haircuts & Fades', 'Full Grooming Experience', 'Scalp Treatment', 'Fashion Hair Coloring',
      'Korean Perm', 'Loose Perm', 'Traditional / Classic Perm', 'Brazilian Blowout Treatment',
      'Protein Straight Bond', 'Cysteine Treatment', 'Trifecta Treatment', 'Protein Gold', 'Non-bleach Highlights'
    ].map(name => ({ id: uid('svc'), name, price: 0 }))
  };
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  return db;
}

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through to seed */ }
  }
  return seedDB();
}

function persistLocal() { localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
function saveDB() { persistLocal(); scheduleSync(); }

let DB = loadDB();
let SESSION = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
let ACTIVE_QUEUE_ID = null; // booking currently being checked out, if any

/* ---------- CLOUD SYNC (Google Sheets via Apps Script Web App) ---------- */
const SETTINGS_KEY = 'sukidesk_settings_v1';
let SETTINGS = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
let syncTimer = null;
let syncStatus = 'idle'; // idle | syncing | synced | error

function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); }
function isCloudConfigured() { return !!(SETTINGS.webAppUrl); }

function setSyncStatus(s) {
  syncStatus = s;
  const el = document.getElementById('sync-status');
  if (!el) return;
  const labels = {
    idle: 'Not connected',
    syncing: 'Syncing…',
    synced: 'Synced' + (SETTINGS.lastSyncedAt ? ' at ' + new Date(SETTINGS.lastSyncedAt).toLocaleTimeString() : ''),
    error: 'Sync error — check URL/token and your connection'
  };
  el.textContent = labels[s] || s;
  el.className = 'sync-status sync-' + s;
}

function scheduleSync() {
  if (!isCloudConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushToCloud, 1500);
}

async function pushToCloud() {
  if (!isCloudConfigured()) return false;
  setSyncStatus('syncing');
  try {
    const res = await fetch(SETTINGS.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveAll', token: SETTINGS.token || '', db: DB })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    SETTINGS.lastSyncedAt = new Date().toISOString();
    saveSettings();
    setSyncStatus('synced');
    return true;
  } catch (e) {
    console.error('SukiDesk cloud push failed', e);
    setSyncStatus('error');
    return false;
  }
}

async function pullFromCloud() {
  if (!isCloudConfigured()) return false;
  setSyncStatus('syncing');
  try {
    const url = SETTINGS.webAppUrl + '?action=getAll&token=' + encodeURIComponent(SETTINGS.token || '');
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    DB = data.db;
    persistLocal();
    SETTINGS.lastSyncedAt = new Date().toISOString();
    saveSettings();
    setSyncStatus('synced');
    return true;
  } catch (e) {
    console.error('SukiDesk cloud pull failed', e);
    setSyncStatus('error');
    return false;
  }
}

/* ---------- helpers ---------- */
function todayStr() { return new Date().toISOString().slice(0, 10); }
function isToday(iso) { return (iso || '').slice(0, 10) === todayStr(); }
function peso(n) { return '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function findStaff(id) { return DB.staff.find(s => s.id === id); }
function findClient(id) { return DB.clients.find(c => c.id === id); }
function currentStaff() { return SESSION ? findStaff(SESSION.staffId) : null; }

function computeCommission(staff, amount) {
  if (!staff) return 0;
  if (staff.commission_type === 'percentage') return round2(amount * (Number(staff.commission_rate) || 0) / 100);
  if (staff.commission_type === 'fixed') return round2(Number(staff.commission_rate) || 0);
  if (staff.commission_type === 'chair-rental') return round2(amount);
  return 0;
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* ---------- app bootstrap ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  bindLogin();
  bindNav();
  bindModals();
  bindSettingsActions();

  if (isCloudConfigured()) {
    showScreen('login');
    document.getElementById('login-staff-grid').innerHTML = '<p class="muted">Connecting to cloud…</p>';
    await pullFromCloud();
  }

  if (SESSION && findStaff(SESSION.staffId)) {
    enterApp();
  } else {
    showScreen('login');
    renderLogin();
  }
});

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('screen-active'));
  document.getElementById('screen-' + name).classList.add('screen-active');
}

function enterApp() {
  const staff = currentStaff();
  document.getElementById('app-user-name').textContent = staff.name;
  document.getElementById('app-user-role').textContent = staff.role === 'owner' ? 'Owner' : 'Staff';
  document.querySelectorAll('.owner-only').forEach(el => {
    el.style.display = staff.role === 'owner' ? '' : 'none';
  });
  showScreen('app');
  goTab('queue');
}

/* ---------- LOGIN ---------- */
let loginStaffId = null;
let pinBuffer = '';

function renderLogin() {
  loginStaffId = null;
  pinBuffer = '';
  const grid = document.getElementById('login-staff-grid');
  grid.innerHTML = DB.staff.map(s => `
    <button class="staff-pick" data-id="${s.id}">
      <span class="staff-pick-avatar">${esc(s.name.slice(0, 1).toUpperCase())}</span>
      <span class="staff-pick-name">${esc(s.name)}</span>
      <span class="staff-pick-role">${s.role === 'owner' ? 'Owner' : 'Staff'}</span>
    </button>
  `).join('') || '<p class="muted">No staff yet. Ask the owner to set one up.</p>';
  document.getElementById('login-pin-panel').classList.add('hidden');
  document.getElementById('login-error').textContent = '';
}

function bindLogin() {
  document.getElementById('login-staff-grid').addEventListener('click', e => {
    const btn = e.target.closest('.staff-pick');
    if (!btn) return;
    loginStaffId = btn.dataset.id;
    pinBuffer = '';
    document.getElementById('login-pin-panel').classList.remove('hidden');
    document.getElementById('login-pin-name').textContent = findStaff(loginStaffId).name;
    updatePinDots();
    document.getElementById('login-error').textContent = '';
  });

  document.getElementById('login-pin-back').addEventListener('click', renderLogin);

  document.getElementById('login-keypad').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.key === 'clear') { pinBuffer = ''; }
    else if (btn.dataset.key === 'del') { pinBuffer = pinBuffer.slice(0, -1); }
    else if (pinBuffer.length < 6) { pinBuffer += btn.dataset.key; }
    updatePinDots();
    if (pinBuffer.length >= 4) tryLogin();
  });
}

function updatePinDots() {
  document.getElementById('login-pin-dots').textContent = '●'.repeat(pinBuffer.length) + '○'.repeat(Math.max(0, 4 - pinBuffer.length));
}

function tryLogin() {
  const staff = findStaff(loginStaffId);
  if (staff && staff.pin === pinBuffer) {
    SESSION = { staffId: staff.id };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
    enterApp();
  } else if (pinBuffer.length >= 4) {
    document.getElementById('login-error').textContent = 'Incorrect PIN. Try again.';
    pinBuffer = '';
    updatePinDots();
  }
}

function logout() {
  SESSION = null;
  sessionStorage.removeItem(SESSION_KEY);
  showScreen('login');
  renderLogin();
}

/* ---------- NAV ---------- */
function bindNav() {
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => goTab(btn.dataset.tab));
  });
  document.getElementById('app-logout').addEventListener('click', logout);
}

function goTab(name) {
  document.querySelectorAll('.app-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.app-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'queue') renderQueue();
  if (name === 'clients') renderClients();
  if (name === 'checkout') renderCheckout();
  if (name === 'reservations') renderReservations();
  if (name === 'dashboard') renderDashboard();
  if (name === 'staff') renderStaffView();
  if (name === 'settings') renderSettings();
}

/* ---------- QUEUE ---------- */
function renderQueue() {
  const list = DB.bookings
    .filter(b => isToday(b.created_at) && b.status !== 'completed' && b.status !== 'no_show')
    .sort((a, b) => (a.scheduled_time || a.created_at).localeCompare(b.scheduled_time || b.created_at));

  const stylistActiveCount = {};
  list.forEach(b => {
    if (b.requested_stylist_id) stylistActiveCount[b.requested_stylist_id] = (stylistActiveCount[b.requested_stylist_id] || 0) + 1;
  });

  document.getElementById('queue-count').textContent = list.length;

  const el = document.getElementById('queue-list');
  if (!list.length) {
    el.innerHTML = '<p class="muted">No one in the queue right now. Add a walk-in to get started.</p>';
    return;
  }

  el.innerHTML = list.map(b => {
    const stylist = b.requested_stylist_id ? findStaff(b.requested_stylist_id) : null;
    const conflict = stylist && stylistActiveCount[stylist.id] > 1;
    const time = b.scheduled_time ? new Date(b.scheduled_time).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '—';
    return `
    <div class="queue-row">
      <div class="queue-row-time">${time}</div>
      <div class="queue-row-main">
        <strong>${esc(b.client_name)}</strong>
        <span class="muted">${esc(b.service)}</span>
        <span class="tag">${b.source}</span>
        ${conflict ? '<span class="tag tag-warn">⚠ stylist double-booked</span>' : ''}
      </div>
      <div class="queue-row-stylist">${stylist ? esc(stylist.name) : '<span class="muted">Any stylist</span>'}</div>
      <div class="queue-row-status"><span class="badge badge-${b.status}">${b.status.replace('_', ' ')}</span></div>
      <div class="queue-row-actions">
        ${b.status === 'pending' ? `<button class="btn-sm" data-act="start" data-id="${b.id}">Start</button>` : ''}
        ${b.status === 'in_queue' ? `<button class="btn-sm btn-sm-primary" data-act="checkout" data-id="${b.id}">Checkout</button>` : ''}
        <button class="btn-sm btn-sm-danger" data-act="noshow" data-id="${b.id}">No-show</button>
      </div>
    </div>`;
  }).join('');
}

function bindQueueActions() {
  document.getElementById('queue-list').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const booking = DB.bookings.find(b => b.id === btn.dataset.id);
    if (!booking) return;
    if (btn.dataset.act === 'start') { booking.status = 'in_queue'; saveDB(); renderQueue(); }
    if (btn.dataset.act === 'noshow') { booking.status = 'no_show'; saveDB(); renderQueue(); }
    if (btn.dataset.act === 'checkout') {
      ACTIVE_QUEUE_ID = booking.id;
      goTab('checkout');
    }
  });

  document.getElementById('walkin-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get('client_name').trim();
    if (!name) return;
    const stylistId = fd.get('stylist') || '';
    DB.bookings.push({
      id: uid('bkg'),
      client_id: null,
      client_name: name,
      client_contact: fd.get('client_contact').trim(),
      requested_stylist_id: stylistId,
      service: fd.get('service') || 'Not specified',
      source: 'walk-in',
      status: 'pending',
      scheduled_time: new Date().toISOString(),
      created_at: new Date().toISOString()
    });
    saveDB();
    e.target.reset();
    renderQueue();
  });
}

function fillStylistOptions(selectEl, includeAny) {
  selectEl.innerHTML = (includeAny ? '<option value="">Any stylist</option>' : '') +
    DB.staff.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}

function fillServiceOptions(selectEl) {
  selectEl.innerHTML = '<option value="">Select service…</option>' +
    DB.services.map(s => `<option value="${s.id}">${esc(s.name)}${s.price ? ' — ' + peso(s.price) : ''}</option>`).join('');
}

/* ---------- RESERVATIONS (online bookings, synced from the website via Sheets) ---------- */
function renderReservations() {
  const list = DB.bookings
    .filter(b => b.source === 'online')
    .sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));

  document.getElementById('reservations-count').textContent = list.length;

  const el = document.getElementById('reservations-list');
  if (!list.length) {
    el.innerHTML = '<p class="muted">No online reservations synced yet. Pull from Cloud in Settings if you\'re expecting some.</p>';
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Date</th><th>Time</th><th>Service</th><th>Name</th><th>Phone</th><th>Email</th><th>Status</th></tr></thead>
      <tbody>
        ${list.map(b => {
          const dt = b.scheduled_time ? new Date(b.scheduled_time) : null;
          const dateStr = dt ? dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : '—';
          const timeStr = dt ? dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : '—';
          return `
          <tr>
            <td>${dateStr}</td>
            <td>${timeStr}</td>
            <td>${esc(b.service)}</td>
            <td>${esc(b.client_name)}</td>
            <td>${esc(b.client_contact || '—')}</td>
            <td>${esc(b.client_email || '—')}</td>
            <td><span class="badge badge-${b.status}">${esc((b.status || '').replace('_', ' '))}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

/* ---------- CLIENTS ---------- */
let clientSearchTerm = '';
let selectedClientId = null;

function renderClients() {
  const term = clientSearchTerm.toLowerCase();
  const list = DB.clients
    .filter(c => !term || c.name.toLowerCase().includes(term) || (c.contact_number || '').includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));

  const el = document.getElementById('clients-list');
  if (!list.length) {
    el.innerHTML = `<p class="muted">${DB.clients.length ? 'No clients match your search.' : 'No clients yet — they\'re added automatically at checkout, or add one manually.'}</p>`;
  } else {
    el.innerHTML = list.map(c => `
      <div class="client-row ${c.id === selectedClientId ? 'client-row-active' : ''}" data-id="${c.id}">
        <div>
          <strong>${esc(c.name)}</strong>
          <span class="muted">${esc(c.contact_number || 'no phone')}</span>
        </div>
        <div class="muted">${c.total_visits || 0} visit${c.total_visits === 1 ? '' : 's'}</div>
      </div>
    `).join('');
  }
  renderClientDetail();
}

function renderClientDetail() {
  const panel = document.getElementById('client-detail');
  const c = selectedClientId ? findClient(selectedClientId) : null;
  if (!c) {
    panel.innerHTML = '<p class="muted">Select a client to view their history.</p>';
    return;
  }
  const history = DB.transactions.filter(t => t.client_id === c.id).sort((a, b) => b.date.localeCompare(a.date));
  panel.innerHTML = `
    <h3>${esc(c.name)}</h3>
    <p class="muted">${esc(c.contact_number || 'No phone on file')}</p>
    <div class="field">
      <label>Preferred stylist</label>
      <select id="client-pref-stylist">${'<option value="">None</option>' + DB.staff.map(s => `<option value="${s.id}" ${s.id === c.preferred_stylist ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>Notes (allergies, product used, etc.)</label>
      <textarea id="client-notes" rows="3">${esc(c.notes || '')}</textarea>
    </div>
    <button class="btn-sm btn-sm-primary" id="client-save">Save</button>
    <h4 style="margin-top:24px;">Visit History</h4>
    ${history.length ? `<div class="history-list">${history.map(t => `
      <div class="history-row">
        <span>${t.date.slice(0, 10)}</span>
        <span>${esc(t.services.map(s => s.name).join(', '))}</span>
        <span>${peso(t.amount)}</span>
      </div>`).join('')}</div>` : '<p class="muted">No visits recorded yet.</p>'}
  `;
  document.getElementById('client-save').addEventListener('click', () => {
    c.notes = document.getElementById('client-notes').value;
    c.preferred_stylist = document.getElementById('client-pref-stylist').value || null;
    saveDB();
    renderClients();
  });
}

function bindClientActions() {
  document.getElementById('client-search').addEventListener('input', e => {
    clientSearchTerm = e.target.value;
    renderClients();
  });
  document.getElementById('clients-list').addEventListener('click', e => {
    const row = e.target.closest('.client-row');
    if (!row) return;
    selectedClientId = row.dataset.id;
    renderClients();
  });
  document.getElementById('client-add-btn').addEventListener('click', () => openModal('modal-add-client'));
  document.getElementById('add-client-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const client = {
      id: uid('cli'),
      name: fd.get('name').trim(),
      contact_number: fd.get('contact_number').trim(),
      preferred_stylist: null,
      notes: '',
      first_visit_date: todayStr(),
      last_visit_date: null,
      total_visits: 0
    };
    if (!client.name) return;
    DB.clients.push(client);
    saveDB();
    e.target.reset();
    closeModal('modal-add-client');
    renderClients();
  });
}

function getOrCreateClient(name, contact) {
  let c = DB.clients.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!c) {
    c = { id: uid('cli'), name, contact_number: contact || '', preferred_stylist: null, notes: '', first_visit_date: todayStr(), last_visit_date: null, total_visits: 0 };
    DB.clients.push(c);
  }
  return c;
}

/* ---------- CHECKOUT ---------- */
let checkoutCart = [];

function renderCheckout() {
  checkoutCart = [];
  const booking = ACTIVE_QUEUE_ID ? DB.bookings.find(b => b.id === ACTIVE_QUEUE_ID) : null;

  document.getElementById('checkout-client-name').value = booking ? booking.client_name : '';
  document.getElementById('checkout-client-contact').value = booking ? (booking.client_contact || '') : '';

  fillStylistOptions(document.getElementById('checkout-stylist'), false);
  if (booking && booking.requested_stylist_id) document.getElementById('checkout-stylist').value = booking.requested_stylist_id;

  fillServiceOptions(document.getElementById('checkout-service-add'));
  document.getElementById('checkout-payment').value = 'cash';
  renderCheckoutCart();

  document.getElementById('checkout-source-note').textContent = booking
    ? `From queue: ${booking.service} (${booking.source})`
    : 'Walk-up sale (not from queue)';
}

function renderCheckoutCart() {
  const el = document.getElementById('checkout-cart');
  el.innerHTML = checkoutCart.length
    ? checkoutCart.map((item, i) => `
      <div class="cart-row">
        <span>${esc(item.name)}</span>
        <span>${peso(item.price)}</span>
        <button type="button" class="btn-sm btn-sm-danger" data-i="${i}">✕</button>
      </div>`).join('')
    : '<p class="muted">No services added yet.</p>';

  const total = checkoutCart.reduce((sum, i) => sum + Number(i.price || 0), 0);
  document.getElementById('checkout-total').textContent = peso(total);

  const stylist = findStaff(document.getElementById('checkout-stylist').value);
  const commission = computeCommission(stylist, total);
  document.getElementById('checkout-commission').textContent = stylist ? peso(commission) + ` (${esc(stylist.name)})` : '—';
}

function bindCheckoutActions() {
  document.getElementById('checkout-add-service').addEventListener('click', () => {
    const sel = document.getElementById('checkout-service-add');
    const svc = DB.services.find(s => s.id === sel.value);
    if (!svc) return;
    checkoutCart.push({ name: svc.name, price: Number(svc.price) || 0 });
    renderCheckoutCart();
  });

  document.getElementById('checkout-cart').addEventListener('click', e => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    checkoutCart.splice(Number(btn.dataset.i), 1);
    renderCheckoutCart();
  });

  document.getElementById('checkout-stylist').addEventListener('change', renderCheckoutCart);

  document.getElementById('checkout-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('checkout-client-name').value.trim();
    const contact = document.getElementById('checkout-client-contact').value.trim();
    const stylistId = document.getElementById('checkout-stylist').value;
    const payment = document.getElementById('checkout-payment').value;
    if (!name || !checkoutCart.length || !stylistId) {
      alert('Add a client name, at least one service, and a stylist before completing checkout.');
      return;
    }
    const client = getOrCreateClient(name, contact);
    client.last_visit_date = todayStr();
    client.total_visits = (client.total_visits || 0) + 1;

    const stylist = findStaff(stylistId);
    const amount = checkoutCart.reduce((sum, i) => sum + Number(i.price || 0), 0);
    const commission = computeCommission(stylist, amount);

    DB.transactions.push({
      id: uid('txn'),
      booking_id: ACTIVE_QUEUE_ID,
      client_id: client.id,
      client_name: client.name,
      staff_id: stylist.id,
      staff_name: stylist.name,
      services: checkoutCart.slice(),
      amount,
      payment_method: payment,
      commission_amount: commission,
      commission_rate_used: stylist.commission_rate,
      date: new Date().toISOString()
    });

    if (ACTIVE_QUEUE_ID) {
      const booking = DB.bookings.find(b => b.id === ACTIVE_QUEUE_ID);
      if (booking) { booking.status = 'completed'; booking.client_id = client.id; }
    }

    saveDB();
    ACTIVE_QUEUE_ID = null;
    checkoutCart = [];
    goTab('dashboard');
  });
}

/* ---------- DASHBOARD ---------- */
function renderDashboard() {
  const todaysTxns = DB.transactions.filter(t => isToday(t.date));
  const todaysQueue = DB.bookings.filter(b => isToday(b.created_at));

  const totalSales = todaysTxns.reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalCommission = todaysTxns.reduce((s, t) => s + Number(t.commission_amount || 0), 0);

  document.getElementById('stat-queue-today').textContent = todaysQueue.filter(b => b.status !== 'no_show').length;
  document.getElementById('stat-sales-today').textContent = peso(totalSales);
  document.getElementById('stat-clients-today').textContent = new Set(todaysTxns.map(t => t.client_id)).size;
  document.getElementById('stat-commission-today').textContent = peso(totalCommission);

  const byStaff = {};
  todaysTxns.forEach(t => {
    byStaff[t.staff_id] = byStaff[t.staff_id] || { name: t.staff_name, count: 0, sales: 0, commission: 0 };
    byStaff[t.staff_id].count++;
    byStaff[t.staff_id].sales += Number(t.amount || 0);
    byStaff[t.staff_id].commission += Number(t.commission_amount || 0);
  });

  const rows = Object.values(byStaff);
  const el = document.getElementById('dashboard-payouts');
  el.innerHTML = rows.length ? `
    <table class="data-table">
      <thead><tr><th>Staff</th><th>Clients</th><th>Sales</th><th>Commission Owed</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${peso(r.sales)}</td><td>${peso(r.commission)}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="muted">No transactions logged today yet.</p>';
}

/* ---------- STAFF (owner only) ---------- */
function renderStaffView() {
  const el = document.getElementById('staff-list');
  el.innerHTML = DB.staff.map(s => `
    <div class="staff-row">
      <div>
        <strong>${esc(s.name)}</strong>
        <span class="tag">${s.role}</span>
      </div>
      <div class="muted">${s.commission_type === 'percentage' ? s.commission_rate + '% per service' : s.commission_type === 'fixed' ? peso(s.commission_rate) + ' fixed' : 'Chair rental'}</div>
      <button class="btn-sm btn-sm-danger" data-act="remove" data-id="${s.id}" ${s.role === 'owner' ? 'disabled title="Cannot remove owner"' : ''}>Remove</button>
    </div>
  `).join('');
}

function bindStaffActions() {
  document.getElementById('staff-add-btn').addEventListener('click', () => openModal('modal-add-staff'));
  document.getElementById('add-staff-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pin = fd.get('pin').trim();
    if (!/^\d{4,6}$/.test(pin)) { alert('PIN must be 4–6 digits.'); return; }
    DB.staff.push({
      id: uid('stf'),
      name: fd.get('name').trim(),
      pin,
      role: 'staff',
      commission_type: fd.get('commission_type'),
      commission_rate: Number(fd.get('commission_rate')) || 0,
      contact_number: fd.get('contact_number').trim()
    });
    saveDB();
    e.target.reset();
    closeModal('modal-add-staff');
    renderStaffView();
  });
  document.getElementById('staff-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act="remove"]');
    if (!btn || btn.disabled) return;
    if (!confirm('Remove this staff member?')) return;
    DB.staff = DB.staff.filter(s => s.id !== btn.dataset.id);
    saveDB();
    renderStaffView();
  });
}

/* ---------- SERVICES (owner only, inside Staff tab) ---------- */
function renderServicesEditor() {
  const el = document.getElementById('services-editor');
  el.innerHTML = DB.services.map(s => `
    <div class="service-edit-row">
      <span>${esc(s.name)}</span>
      <input type="number" min="0" step="1" value="${s.price || ''}" placeholder="price" data-id="${s.id}" class="price-input">
    </div>
  `).join('');
}

function bindServicesEditor() {
  document.getElementById('services-editor').addEventListener('change', e => {
    const input = e.target.closest('.price-input');
    if (!input) return;
    const svc = DB.services.find(s => s.id === input.dataset.id);
    if (svc) { svc.price = Number(input.value) || 0; saveDB(); }
  });
}

/* ---------- SETTINGS (owner only) ---------- */
function renderSettings() {
  const form = document.getElementById('settings-form');
  form.webAppUrl.value = SETTINGS.webAppUrl || '';
  form.token.value = SETTINGS.token || '';
  setSyncStatus(syncStatus);
}

function bindSettingsActions() {
  document.getElementById('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    SETTINGS.webAppUrl = fd.get('webAppUrl').trim();
    SETTINGS.token = fd.get('token').trim();
    saveSettings();
    alert('Settings saved.');
    setSyncStatus(isCloudConfigured() ? 'idle' : 'idle');
  });

  document.getElementById('settings-push').addEventListener('click', async () => {
    const ok = await pushToCloud();
    if (ok) alert('Pushed local data to the Sheet.');
  });

  document.getElementById('settings-pull').addEventListener('click', async () => {
    if (!confirm("This replaces the data on this device with what's currently in the Sheet. Continue?")) return;
    const ok = await pullFromCloud();
    if (ok) { alert('Pulled latest data from the Sheet.'); goTab('dashboard'); }
  });
}

/* ---------- MODALS ---------- */
function openModal(id) { document.getElementById(id).classList.add('modal-open'); }
function closeModal(id) { document.getElementById(id).classList.remove('modal-open'); }

function bindModals() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  bindQueueActions();
  bindClientActions();
  bindCheckoutActions();
  bindStaffActions();
  bindServicesEditor();

  fillStylistOptions(document.getElementById('walkin-stylist'), true);
  fillServiceOptions(document.getElementById('walkin-service'));
  renderServicesEditor();
}
