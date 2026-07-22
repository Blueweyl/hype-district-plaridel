const { verifyWebhookSignature } = require('./_lib/paymongo');
const { confirmReservation } = require('./_lib/reservation');

// Needed so we can verify PayMongo's signature against the exact raw request
// bytes — same reasoning as stripe-webhook.js.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const rawBody = await readRawBody(req);
  const sig = req.headers['paymongo-signature'];

  if (!verifyWebhookSignature(rawBody, sig, process.env.PAYMONGO_WEBHOOK_SECRET)) {
    console.error('PayMongo webhook signature verification failed');
    res.status(400).send('Webhook Error: invalid signature');
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const eventType = event?.data?.attributes?.type;
  if (eventType !== 'checkout_session.payment.paid') {
    res.status(200).json({ received: true, ignored: eventType });
    return;
  }

  // For this event, attributes.data is the Payment resource that was just
  // paid — PayMongo copies the Checkout Session's metadata onto it, so we
  // read date/time/service/contact info from there rather than needing a
  // second API call back to PayMongo to re-fetch the session.
  const payment = event.data.attributes.data;
  const meta = (payment && payment.attributes && payment.attributes.metadata) || {};
  const { date, time, serviceId, serviceName, price, firstName, phoneLast4, fullName, phone, email } = meta;

  if (!date || !time) {
    console.error('Missing date/time in payment metadata', payment && payment.id);
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
      provider: 'paymongo',
      providerSessionId: payment.id,
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
