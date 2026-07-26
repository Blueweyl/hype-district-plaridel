// Manual GCash transfer flow: unlike Stripe/PayMongo, there is no payment
// provider webhook to confirm a direct bank transfer, so this endpoint is the
// one exception to "webhooks are the only place a reservation is written" —
// it writes the reservation itself, immediately, marked status:'payment_pending'
// on the strength of the uploaded screenshot alone. Staff verify the transfer
// (amount/reference against the screenshot, which is pushed to the private
// SukiDesk Sheet/Drive, never the public repo) and follow up with the customer.
const { validateBooking } = require('./_lib/booking-validate');
const { confirmReservation } = require('./_lib/reservation');

module.exports.config = { api: { bodyParser: { sizeLimit: '6mb' } } };

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'https://blueweyl.github.io')
  .split(',')
  .map((s) => s.trim());

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PROOF_BYTES = 4 * 1024 * 1024;

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

  const {
    serviceIds,
    date,
    time,
    fullName,
    phone,
    email,
    gcashReference,
    proofImageBase64,
    proofImageMimeType,
  } = body || {};

  const validation = await validateBooking({ serviceIds, date, time, fullName, phone, email });
  if (validation.error) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }
  const { services, totalPrice, combinedName, firstName, phoneLast4 } = validation;

  if (!proofImageBase64 || !proofImageMimeType) {
    res.status(400).json({ error: 'Please attach a screenshot of your GCash payment.' });
    return;
  }
  if (!ALLOWED_MIME_TYPES.includes(proofImageMimeType)) {
    res.status(400).json({ error: 'Screenshot must be a JPG, PNG, or WEBP image.' });
    return;
  }
  const approxBytes = Math.ceil((proofImageBase64.length * 3) / 4);
  if (approxBytes > MAX_PROOF_BYTES) {
    res.status(400).json({ error: 'That image is too large — please attach a screenshot under 4MB.' });
    return;
  }

  const providerSessionId = `gcash_manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let result;
  try {
    result = await confirmReservation({
      date,
      time,
      serviceId: services.map((s) => s.id).join(','),
      serviceName: combinedName,
      price: totalPrice,
      firstName,
      phoneLast4,
      fullName,
      phone,
      email,
      provider: 'gcash_manual',
      providerSessionId,
      status: 'payment_pending',
      gcashReference,
      proofImageBase64,
      proofImageMimeType,
    });
  } catch (err) {
    console.error('GCash manual booking failed', err);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
    return;
  }

  if (result.alreadyProcessed) {
    res.status(409).json({ error: 'That slot was just booked — please pick another time.' });
    return;
  }
  if (result.ok === false) {
    res.status(500).json({ error: 'Failed to save your booking — please try again.' });
    return;
  }

  res.status(200).json({ ok: true });
};
