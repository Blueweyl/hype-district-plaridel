// Server-side slot generation — keep in sync with js/reserve.js's generateSlots().
// Business hours are fixed in Asia/Manila time (UTC+8, no DST).
const MANILA_OFFSET = '+08:00';

function generateSlots(hours) {
  const [openH, openM] = hours.openTime.split(':').map(Number);
  const [closeH, closeM] = hours.closeTime.split(':').map(Number);
  const open = openH * 60 + openM;
  const close = closeH * 60 + closeM;
  const slots = [];
  for (let t = open; t + hours.slotMinutes <= close; t += hours.slotMinutes) {
    const h = String(Math.floor(t / 60)).padStart(2, '0');
    const m = String(t % 60).padStart(2, '0');
    slots.push(`${h}:${m}`);
  }
  return slots;
}

function isValidSlot(date, time, hours) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  if (!/^\d{2}:\d{2}$/.test(time || '')) return false;
  return generateSlots(hours).includes(time);
}

function isInPast(date, time) {
  const slotMs = Date.parse(`${date}T${time}:00${MANILA_OFFSET}`);
  if (Number.isNaN(slotMs)) return true;
  return slotMs <= Date.now();
}

module.exports = { generateSlots, isValidSlot, isInPast };
