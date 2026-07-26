const Stripe = require('stripe');
const { validateBooking } = require('./_lib/booking-validate');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'https://blueweyl.github.io')
  .split(',')
  .map((s) => s.trim());
// The site is a GitHub *project* page (served under /hype-district-plaridel/,
// not at the bare origin), so redirects need this path — unlike ALLOWED_ORIGINS,
// which must stay the bare origin to match the browser's Origin header for CORS.
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

  const { serviceIds, date, time, fullName, phone, email } = body || {};

  const validation = await validateBooking({ serviceIds, date, time, fullName, phone, email });
  if (validation.error) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }
  const { services, totalPrice, combinedName, firstName, phoneLast4 } = validation;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: services.map((service) => ({
        price_data: {
          currency: 'php',
          unit_amount: service.price * 100,
          product_data: { name: service.name },
        },
        quantity: 1,
      })),
      customer_email: email,
      metadata: {
        serviceId: services.map((s) => s.id).join(','),
        serviceName: combinedName,
        price: String(totalPrice),
        date,
        time,
        firstName,
        phoneLast4,
        fullName,
        phone,
      },
      success_url: `${SITE_BASE_URL}/reserve.html?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_BASE_URL}/reserve.html?canceled=1`,
    });
  } catch (err) {
    console.error('Stripe session creation failed', err);
    res.status(502).json({ error: 'Payment provider error — please try again.' });
    return;
  }

  res.status(200).json({ url: session.url });
};
