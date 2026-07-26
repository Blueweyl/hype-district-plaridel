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

async function removeFromAvailabilityIndex(date, time, attempt = 0) {
  try {
    const file = await getFile('content/availability.json');
    if (!file) return;
    const data = JSON.parse(file.content);
    if (!data[date]) return;
    data[date] = data[date].filter((t) => t !== time);
    if (!data[date].length) delete data[date];

    const putRes = await putFile('content/availability.json', data, `Release availability: ${date} ${time}`, file.sha);

    if (putRes.status === 409 && attempt < 2) {
      await removeFromAvailabilityIndex(date, time, attempt + 1);
    } else if (!putRes.ok && putRes.status !== 409) {
      console.error('Failed to release availability index', putRes.status, await putRes.text());
    }
  } catch (err) {
    console.error('Availability release error', err);
  }
}

// Best-effort push of the full booking (name/phone/email — never written to the
// public repo) into the SukiDesk Google Sheet, so staff can see who's coming in
// without needing to look it up in the payment provider's dashboard. If this
// fails or isn't configured, the reservation itself is unaffected — the repo
// commit is the source of truth. `booking.proofImageBase64`/`proofImageMimeType`
// (GCash manual-transfer bookings only) are consumed by Code.gs's addBooking
// handler to store the screenshot in Drive — they're not in the Bookings tab's
// own column list so they never end up written to the sheet as raw base64.
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

// `provider` is 'stripe' | 'paymongo' | 'gcash_manual'; `providerSessionId` is
// that provider's checkout session id (or a generated id for gcash_manual),
// stored for support lookups but no longer relied on for idempotency — the
// create-only GitHub write (no `sha`) is the hard guard.
//
// `status` defaults to 'confirmed' (payment already verified by
// Stripe/PayMongo before this runs). GCash manual-transfer bookings pass
// 'payment_pending' instead, since there's no webhook to confirm a direct
// bank transfer — the slot is held on the strength of the uploaded proof
// screenshot alone, pending a staff check in SukiDesk.
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
  status = 'confirmed',
  gcashReference,
  proofImageBase64,
  proofImageMimeType,
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
    status,
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
    status,
    gcash_reference: gcashReference || '',
    scheduled_time: `${date}T${time}:00+08:00`,
    created_at: new Date().toISOString(),
    proofImageBase64,
    proofImageMimeType,
  });

  return { ok: true };
}

// Staff accept/reject of a payment_pending GCash reservation, driven from the
// SukiDesk app's Reservations tab (see api/update-reservation-status.js).
// This is the one place a reservation file is ever *updated* rather than
// create-only-written. On reject, the slot is released back to
// availability.json since the payment was never actually verified.
async function resolvePendingReservation({ date, time, approve }) {
  const path = `content/reservations/${date}-${time.replace(':', '')}.json`;
  const file = await getFile(path);
  if (!file) {
    return { notFound: true };
  }

  const reservation = JSON.parse(file.content);
  reservation.status = approve ? 'confirmed' : 'payment_rejected';
  reservation.statusUpdatedAt = new Date().toISOString();

  const putRes = await putFile(
    path,
    reservation,
    `Reservation ${approve ? 'confirmed' : 'rejected'}: ${date} ${time}`,
    file.sha
  );
  if (!putRes.ok) {
    console.error('Failed to update reservation status', putRes.status, await putRes.text());
    return { ok: false };
  }

  if (!approve) {
    await removeFromAvailabilityIndex(date, time);
  }

  return { ok: true, reservation };
}

module.exports = { confirmReservation, resolvePendingReservation };
