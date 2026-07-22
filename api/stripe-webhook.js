const Stripe = require('stripe');
const { confirmReservation } = require('./_lib/reservation');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Vercel Functions honor this the same way Next.js API routes do — needed
// so we can verify Stripe's signature against the exact raw request bytes.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const rawBody = await readRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type !== 'checkout.session.completed') {
    res.status(200).json({ received: true, ignored: event.type });
    return;
  }

  const session = event.data.object;
  const meta = session.metadata || {};
  const { date, time, serviceId, serviceName, price, firstName, phoneLast4, fullName, phone } = meta;
  const email = (session.customer_details && session.customer_details.email) || session.customer_email || '';

  if (!date || !time) {
    console.error('Missing date/time in session metadata', session.id);
    res.status(200).json({ received: true, error: 'missing metadata' });
    return;
  }

  try {
    const result = await confirmReservation({
      date,
      time,
      serviceId,
      serviceName,
      price,
      firstName,
      phoneLast4,
      fullName,
      phone,
      email,
      provider: 'stripe',
      providerSessionId: session.id,
    });

    if (result.ok === false) {
      res.status(500).json({ error: 'Failed to persist reservation' });
      return;
    }

    res.status(200).json({ received: true, alreadyProcessed: !!result.alreadyProcessed });
  } catch (err) {
    console.error('Webhook processing error', err);
    res.status(500).json({ error: 'Internal error' });
  }
};
