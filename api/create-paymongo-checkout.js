const { validateBooking } = require('./_lib/booking-validate');
const { createCheckoutSession } = require('./_lib/paymongo');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'https://blueweyl.github.io')
  .split(',')
  .map((s) => s.trim());
const SITE_BASE_URL = process.env.SITE_BASE_URL || 'https://blueweyl.github.io/hype-district-plaridel';

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

  const { serviceId, date, time, fullName, phone, email } = body || {};

  const validation = await validateBooking({ serviceId, date, time, fullName, phone, email });
  if (validation.error) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }
  const { service, firstName, phoneLast4 } = validation;

  // Metadata values must be strings (PayMongo requirement) — this is how the
  // webhook recovers who/what/when, mirroring the Stripe session's metadata.
  const metadata = {
    serviceId: service.id,
    serviceName: service.name,
    price: String(service.price),
    date,
    time,
    firstName,
    phoneLast4,
    fullName,
    phone,
    email,
  };

  let session;
  try {
    session = await createCheckoutSession({
      secretKey: process.env.PAYMONGO_SECRET_KEY,
      lineItems: [
        {
          amount: service.price * 100,
          currency: 'PHP',
          name: service.name,
          quantity: 1,
        },
      ],
      paymentMethodTypes: ['gcash'],
      successUrl: `${SITE_BASE_URL}/reserve.html?success=1&provider=paymongo`,
      cancelUrl: `${SITE_BASE_URL}/reserve.html?canceled=1`,
      description: `${service.name} — Hype District Plaridel`,
      metadata,
    });
  } catch (err) {
    console.error('PayMongo session creation failed', err.status, err.body || err.message);
    res.status(502).json({ error: 'Payment provider error — please try again.' });
    return;
  }

  res.status(200).json({ url: session.attributes.checkout_url });
};
