// Shared "a payment just succeeded, make it a real reservation" logic used by
// both api/stripe-webhook.js and api/paymongo-webhook.js — this is the only
// place a reservation is ever actually written, regardless of which payment
// provider the customer paid through.
const { getFile, putFile } = require('./github');

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

// Best-effort push of the full booking (name/phone/email — never written to the
// public repo) into the SukiDesk Google Sheet, so staff can see who's coming in
// without needing to look it up in the payment provider's dashboard. If this
// fails or isn't configured, the reservation itself is unaffected — the repo
// commit is the source of truth.
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

// `provider` is 'stripe' | 'paymongo'; `providerSessionId` is that provider's
// checkout session id, stored for support lookups but no longer relied on for
// idempotency — the create-only GitHub write (no `sha`) is the hard guard.
async function confirmReservation({
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
  provider,
  providerSessionId,
}) {
  const path = `content/reservations/${date}-${time.replace(':', '')}.json`;

  const existing = await getFile(path);
  if (existing) {
    return { alreadyProcessed: true };
  }

  const reservation = {
    date,
    time,
    serviceId,
    serviceName,
    price: Number(price),
    firstName,
    phoneLast4,
    paymentProvider: provider,
    providerSessionId,
    confirmedAt: new Date().toISOString(),
  };

  const putRes = await putFile(path, reservation, `Reservation: ${date} ${time} — ${serviceName}`);

  if (putRes.status === 422) {
    return { alreadyProcessed: true };
  }
  if (!putRes.ok) {
    console.error('Failed to write reservation file', putRes.status, await putRes.text());
    return { ok: false };
  }

  await updateAvailabilityIndex(date, time);

  await pushToSukiDesk({
    id: `bkg_${provider}_${providerSessionId}`,
    client_id: '',
    client_name: fullName || firstName || '',
    client_contact: phone || '',
    client_email: email || '',
    requested_stylist_id: '',
    service: serviceName || '',
    source: 'online',
    status: 'confirmed',
    scheduled_time: `${date}T${time}:00+08:00`,
    created_at: new Date().toISOString(),
  });

  return { ok: true };
}

module.exports = { confirmReservation };
