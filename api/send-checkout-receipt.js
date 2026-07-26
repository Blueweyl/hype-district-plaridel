// Emails a branded receipt for an in-person SukiDesk checkout (walk-in or
// queued client), called from js/app.js right after a transaction is logged.
// Staff-only action, same trust model as api/update-reservation-status.js —
// gated by SUKIDESK_SECRET rather than customer-facing validation, since
// there's no booking/slot to re-validate against here, just an itemized
// receipt to send wherever the staff member says to send it.
const { sendEmail, checkoutReceiptEmail } = require('./_lib/email');

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

  const { email, fullName, items, total, paymentMethod, staffName, token } = body || {};

  if (!checkAuth(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!email || !Array.isArray(items) || !items.length) {
    res.status(400).json({ error: 'Missing email or items' });
    return;
  }

  const { subject, html } = checkoutReceiptEmail({ fullName, items, total, paymentMethod, staffName });
  const result = await sendEmail({ to: email, subject, html });

  if (result.ok === false) {
    const detail = result.error && (result.error.message || JSON.stringify(result.error));
    res.status(502).json({ error: detail ? `Failed to send receipt email: ${detail}` : 'Failed to send receipt email' });
    return;
  }

  res.status(200).json({ ok: true, emailSent: !!result.ok });
};
