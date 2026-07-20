const Stripe = require('stripe');
const bookingConfig = require('../content/booking-config.json');
const { generateSlots, isValidSlot, isInPast } = require('./_lib/slots');
const { getFile } = require('./_lib/github');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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

  if (!serviceId || !date || !time || !fullName || !phone || !email) {
    res.status(400).json({ error: 'Please fill in all fields.' });
    return;
  }

  const service = bookingConfig.services.find((s) => s.id === serviceId);
  if (!service) {
    res.status(400).json({ error: 'Unknown service selected.' });
    return;
  }

  if (!isValidSlot(date, time, bookingConfig.hours)) {
    res.status(400).json({ error: 'That is not a valid appointment time.' });
    return;
  }

  if (isInPast(date, time)) {
    res.status(400).json({ error: 'That time has already passed — please pick another.' });
    return;
  }

  // Best-effort pre-check; the webhook's create-only GitHub write is the
  // hard guard against two people booking the same slot at the same time.
  try {
    const avail = await getFile('content/availability.json');
    const availData = avail ? JSON.parse(avail.content) : {};
    if (availData[date] && availData[date].includes(time)) {
      res.status(409).json({ error: 'That slot was just booked — please pick another time.' });
      return;
    }
  } catch (err) {
    console.error('Availability pre-check failed', err);
  }

  const firstName = String(fullName).trim().split(/\s+/)[0] || fullName;
  const phoneDigits = String(phone).replace(/\D/g, '');
  const phoneLast4 = phoneDigits.slice(-4);
  const origin = ALLOWED_ORIGINS[0];

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'php',
            unit_amount: service.price * 100,
            product_data: { name: service.name },
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      metadata: {
        serviceId: service.id,
        serviceName: service.name,
        price: String(service.price),
        date,
        time,
        firstName,
        phoneLast4,
        fullName,
        phone,
      },
      success_url: `${origin}/reserve.html?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/reserve.html?canceled=1`,
    });
  } catch (err) {
    console.error('Stripe session creation failed', err);
    res.status(502).json({ error: 'Payment provider error — please try again.' });
    return;
  }

  res.status(200).json({ url: session.url });
};

// Exposed for local/manual sanity checks only — not used by the handler itself.
module.exports.generateSlots = generateSlots;
