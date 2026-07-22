// Minimal PayMongo REST client — raw fetch calls rather than their npm SDK,
// matching this repo's existing pattern (see _lib/github.js) of not pulling in
// a client library just to wrap a couple of HTTP calls.
const crypto = require('crypto');

const API_BASE = 'https://api.paymongo.com/v1';

function authHeader(secretKey) {
  return 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');
}

// metadata values must be strings — PayMongo only accepts string values.
async function createCheckoutSession({ secretKey, lineItems, paymentMethodTypes, successUrl, cancelUrl, description, metadata }) {
  const res = await fetch(`${API_BASE}/checkout_sessions`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(secretKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: lineItems,
          payment_method_types: paymentMethodTypes,
          success_url: successUrl,
          cancel_url: cancelUrl,
          description,
          send_email_receipt: false,
          metadata,
        },
      },
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body?.errors?.[0]?.detail || `PayMongo API error ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body.data; // { id, type, attributes: { checkout_url, metadata, ... } }
}

// Webhook signature format: "t=<timestamp>,te=<test_signature>,li=<live_signature>".
// HMAC-SHA256(webhookSecret, `${timestamp}.${rawBody}`) hex digest must match
// whichever of te/li is non-empty. Algorithm confirmed from PayMongo's own
// Node SDK (WebhookService.prototype.constructEvent) since the prose docs
// don't spell out the exact format.
function verifyWebhookSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(',');
  if (parts.length < 3) return false;

  const timestamp = parts[0].split('=')[1];
  const testSig = parts[1].split('=')[1];
  const liveSig = parts[2].split('=')[1];
  const expected = liveSig || testSig;
  if (!timestamp || !expected) return false;

  const computed = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');

  const a = Buffer.from(computed);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createCheckoutSession, verifyWebhookSignature };
