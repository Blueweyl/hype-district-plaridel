// Staff accept/reject of a payment_pending GCash reservation, called from
// SukiDesk's Reservations tab (js/app.js). Updates the public repo's
// reservation status (and releases the slot back to availability on reject),
// then emails the customer their confirmation/rejection.
//
// Gated by the same SUKIDESK_SECRET already used for the Google Sheet bridge
// (see api/_lib/reservation.js#pushToSukiDesk and apps-script/Code.gs) — this
// isn't a customer-facing endpoint like create-checkout-session, so it needs
// a shared secret rather than just CORS + business-logic validation. If
// SUKIDESK_SECRET isn't configured, auth is skipped (mirrors Code.gs's own
// fallback) since in that case the Reservations tab has nothing to act on anyway.
const { resolvePendingReservation } = require('./_lib/reservation');
const { sendEmail, reservationStatusEmail } = require('./_lib/email');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'https://blueweyl.github.io')
  .split(',')
  .map((s) => s.trim());

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function checkAuth(token) {
  const secret = process.env.SUKIDESK_SECRET;
  if (!secret) return true;
  return token === secret;
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (!body || typeof body !== 'object') {
    try {
      body = JSON.parse(await readRawBody(req));
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  const { date, time, action, token, fullName, email, serviceName } = body || {};

  if (!checkAuth(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!date || !time || (action !== 'confirm' && action !== 'reject')) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const approve = action === 'confirm';

  let result;
  try {
    result = await resolvePendingReservation({ date, time, approve });
  } catch (err) {
    console.error('resolvePendingReservation failed', err);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
    return;
  }

  if (result.notFound) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }
  if (result.ok === false) {
    res.status(500).json({ error: 'Failed to update the reservation' });
    return;
  }

  let emailResult = { skipped: true };
  if (email) {
    const { subject, html } = reservationStatusEmail({
      approve,
      fullName,
      serviceName: serviceName || result.reservation.serviceName,
      date,
      time,
    });
    emailResult = await sendEmail({ to: email, subject, html });
  }

  res.status(200).json({ ok: true, emailSent: !!emailResult.ok });
};
