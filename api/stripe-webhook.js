const Stripe = require('stripe');
const { getFile, putFile } = require('./_lib/github');

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

// Best-effort push of the full booking (name/phone/email — never written to the
// public repo) into the SukiDesk Google Sheet, so staff can see who's coming in
// without needing to look it up in Stripe. If this fails or isn't configured,
// the reservation itself is unaffected — the repo commit above is the source of truth.
async function pushToSukiDesk(booking) {
  const url = process.env.SUKIDESK_WEBAPP_URL;
  const token = process.env.SUKIDESK_SECRET;
  if (!url || !token) return;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'addBooking', token, booking }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      console.error('SukiDesk push failed', res.status, data.error);
    }
  } catch (err) {
    console.error('SukiDesk push error', err);
  }
}

async function updateAvailabilityIndex(date, time, attempt = 0) {
  try {
    const file = await getFile('content/availability.json');
    const data = file ? JSON.parse(file.content) : {};
    const times = new Set(data[date] || []);
    times.add(time);
    data[date] = Array.from(times).sort();

    const putRes = await putFile(
      'content/availability.json',
      data,
      `Update availability: ${date} ${time}`,
      file ? file.sha : undefined
    );

    if (putRes.status === 409 && attempt < 2) {
      await updateAvailabilityIndex(date, time, attempt + 1);
    } else if (!putRes.ok && putRes.status !== 409) {
      console.error('Failed to update availability index', putRes.status, await putRes.text());
    }
  } catch (err) {
    console.error('Availability index update error', err);
  }
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

  const path = `content/reservations/${date}-${time.replace(':', '')}.json`;

  try {
    // Idempotency: a duplicate delivery of an already-processed event is a no-op.
    const existing = await getFile(path);
    if (existing) {
      res.status(200).json({ received: true, alreadyProcessed: true });
      return;
    }

    const reservation = {
      date,
      time,
      serviceId,
      serviceName,
      price: Number(price),
      firstName,
      phoneLast4,
      stripeSessionId: session.id,
      confirmedAt: new Date().toISOString(),
    };

    // No `sha` passed — create-only. If two checkouts somehow raced for the
    // same slot, GitHub itself rejects the second write with 422.
    const putRes = await putFile(path, reservation, `Reservation: ${date} ${time} — ${serviceName}`);

    if (putRes.status === 422) {
      res.status(200).json({ received: true, alreadyProcessed: true });
      return;
    }
    if (!putRes.ok) {
      console.error('Failed to write reservation file', putRes.status, await putRes.text());
      res.status(500).json({ error: 'Failed to persist reservation' });
      return;
    }

    await updateAvailabilityIndex(date, time);

    await pushToSukiDesk({
      id: 'bkg_' + session.id,
      client_id: '',
      client_name: fullName || firstName || '',
      client_contact: phone || '',
      client_email: email,
      requested_stylist_id: '',
      service: serviceName || '',
      source: 'online',
      status: 'confirmed',
      scheduled_time: `${date}T${time}:00+08:00`,
      created_at: new Date().toISOString(),
    });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error', err);
    res.status(500).json({ error: 'Internal error' });
  }
};
