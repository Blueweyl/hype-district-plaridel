// Shared request validation for both Stripe and PayMongo checkout-session
// creation endpoints — price/service truth always comes from booking-config.json
// on the server, never the client.
const bookingConfig = require('../../content/booking-config.json');
const { isValidSlot, isInPast } = require('./slots');
const { getFile } = require('./github');

async function validateBooking({ serviceId, date, time, fullName, phone, email }) {
  if (!serviceId || !date || !time || !fullName || !phone || !email) {
    return { error: 'Please fill in all fields.', status: 400 };
  }

  const service = bookingConfig.services.find((s) => s.id === serviceId);
  if (!service) {
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

  return { service, firstName, phoneLast4 };
}

module.exports = { validateBooking };
