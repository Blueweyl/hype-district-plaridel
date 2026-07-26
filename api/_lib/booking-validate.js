// Shared request validation for all three checkout-session/booking-request
// endpoints (Stripe, PayMongo, GCash manual) — price/service truth always
// comes from booking-config.json on the server, never the client.
//
// A booking may include multiple services (e.g. haircut + beard trim) — by
// design they all still fit in a single fixed-length slot (see
// content/booking-config.json's `hours.slotMinutes`), rather than each
// service consuming its own consecutive slot. `totalPrice` is just the sum
// of the selected services' prices; `combinedName` joins their names for
// display (Stripe line items, reservation records, receipts, etc).
const bookingConfig = require('../../content/booking-config.json');
const { isValidSlot, isInPast } = require('./slots');
const { getFile } = require('./github');

async function validateBooking({ serviceIds, date, time, fullName, phone, email }) {
  if (!Array.isArray(serviceIds) || !serviceIds.length || !date || !time || !fullName || !phone || !email) {
    return { error: 'Please fill in all fields.', status: 400 };
  }

  const services = serviceIds.map((id) => bookingConfig.services.find((s) => s.id === id));
  if (services.some((s) => !s)) {
    return { error: 'Unknown service selected.', status: 400 };
  }

  if (!isValidSlot(date, time, bookingConfig.hours)) {
    return { error: 'That is not a valid appointment time.', status: 400 };
  }

  if (isInPast(date, time)) {
    return { error: 'That time has already passed — please pick another.', status: 400 };
  }

  // Best-effort pre-check; each webhook's create-only GitHub write is the
  // hard guard against two people booking the same slot at the same time.
  try {
    const avail = await getFile('content/availability.json');
    const availData = avail ? JSON.parse(avail.content) : {};
    if (availData[date] && availData[date].includes(time)) {
      return { error: 'That slot was just booked — please pick another time.', status: 409 };
    }
  } catch (err) {
    console.error('Availability pre-check failed', err);
  }

  const firstName = String(fullName).trim().split(/\s+/)[0] || fullName;
  const phoneDigits = String(phone).replace(/\D/g, '');
  const phoneLast4 = phoneDigits.slice(-4);

  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);
  const combinedName = services.map((s) => s.name).join(' + ');

  return { services, totalPrice, combinedName, firstName, phoneLast4 };
}

module.exports = { validateBooking };
