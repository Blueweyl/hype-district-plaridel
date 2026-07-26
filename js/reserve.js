/* Reservation + payment flow. Card has no card fields on this page at all —
   the server creates a Stripe Checkout Session and this script just
   redirects to Stripe's own hosted, PCI-compliant payment page, confirmed
   only by the server-side Stripe webhook, never this page's success redirect.

   GCash is a direct manual transfer instead of a hosted checkout: this script
   shows the shop's GCash number/QR, the customer uploads a screenshot of the
   transfer, and that's POSTed straight to api/create-gcash-request — which
   books the slot immediately as status:'payment_pending' (no webhook is
   possible for a manual transfer). Staff verify the screenshot in SukiDesk. */

(function () {
  const VERCEL_API_BASE = 'https://hype-district-plaridel.vercel.app';
  const CONFIG_URL = 'content/booking-config.json';
  const AVAILABILITY_URL =
    'https://raw.githubusercontent.com/Blueweyl/hype-district-plaridel/master/content/availability.json';
  const GCASH_NUMBER_DIGITS = '09612720481';
  const MAX_PROOF_BYTES = 4 * 1024 * 1024;
  const ALLOWED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const state = {
    config: null,
    availability: {},
    selectedServices: [],
    selectedDate: null,
    selectedTime: null,
  };

  // Multiple services can be picked for one booking (e.g. haircut + beard
  // trim) — they still share a single fixed-length slot rather than each
  // consuming its own, so total price is just the sum of what's selected.
  function totalPrice() {
    return state.selectedServices.reduce((sum, s) => sum + s.price, 0);
  }

  const els = {};

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

  function formatTime12h(time) {
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  function formatPeso(amount) {
    return '₱' + Number(amount).toLocaleString('en-PH');
  }

  // Manila is UTC+8 with no DST, so shifting the UTC epoch by a fixed 8
  // hours before reading the date/time parts is a reliable, dependency-free
  // way to work in Plaridel local time regardless of the visitor's own timezone.
  function manilaNow() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000);
  }

  function todayStr() {
    return manilaNow().toISOString().slice(0, 10);
  }

  function isPastSlot(dateStr, time) {
    const slotMs = Date.parse(`${dateStr}T${time}:00+08:00`);
    return slotMs <= Date.now();
  }

  function renderServices() {
    const list = els.serviceList;
    list.innerHTML = '';
    state.config.services.forEach((service) => {
      const label = document.createElement('label');
      label.className = 'service-pill';
      label.dataset.serviceId = service.id;
      label.innerHTML =
        '<input type="checkbox" value="' + service.id + '">' +
        '<span class="service-pill-name">' + service.name + '</span>' +
        '<span class="service-pill-price">' + formatPeso(service.price) + '</span>';
      label.querySelector('input').addEventListener('change', (e) => toggleService(service, e.target.checked));
      list.appendChild(label);
    });
  }

  function toggleService(service, checked) {
    if (checked) {
      if (!state.selectedServices.some((s) => s.id === service.id)) {
        state.selectedServices.push(service);
      }
    } else {
      state.selectedServices = state.selectedServices.filter((s) => s.id !== service.id);
    }
    const label = els.serviceList.querySelector('[data-service-id="' + service.id + '"]');
    if (label) label.classList.toggle('selected', checked);
    updateSummary();
  }

  function renderSlots() {
    const grid = els.slotGrid;
    grid.innerHTML = '';
    state.selectedTime = null;
    updateSummary();

    if (!state.selectedDate) {
      grid.innerHTML = '<span class="slot-empty">Select a date to see available times.</span>';
      return;
    }

    const allSlots = generateSlots(state.config.hours);
    const taken = new Set(state.availability[state.selectedDate] || []);
    const isToday = state.selectedDate === todayStr();

    let anyAvailable = false;
    allSlots.forEach((time) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot';
      btn.dataset.time = time;
      btn.textContent = formatTime12h(time);

      const past = isToday && isPastSlot(state.selectedDate, time);
      const isTaken = taken.has(time);
      if (isTaken || past) {
        btn.classList.add('taken');
        btn.disabled = true;
      } else {
        anyAvailable = true;
        btn.addEventListener('click', () => selectSlot(time, btn));
      }
      grid.appendChild(btn);
    });

    if (!anyAvailable) {
      const msg = document.createElement('span');
      msg.className = 'slot-empty';
      msg.textContent = 'No times left for this date — try another day.';
      grid.appendChild(msg);
    }
  }

  function selectSlot(time, btn) {
    state.selectedTime = time;
    els.slotGrid.querySelectorAll('.slot').forEach((el) => el.classList.remove('selected'));
    btn.classList.add('selected');
    updateSummary();
  }

  function updateSummary() {
    const hasService = state.selectedServices.length > 0;
    const ready = hasService && state.selectedDate && state.selectedTime;
    els.totalAmount.textContent = hasService ? formatPeso(totalPrice()) : '₱0';

    els.payBtn.disabled = !ready;
    els.gcashToggle.disabled = !ready;

    if (ready) {
      els.payBtn.textContent = 'Pay with Card — ' + formatPeso(totalPrice());
      els.gcashToggle.textContent = 'Pay with GCash — ' + formatPeso(totalPrice());
      els.gcashAmount.textContent = formatPeso(totalPrice());
    } else if (hasService) {
      els.payBtn.textContent = 'Pick a date & time';
      els.gcashToggle.textContent = 'Pick a date & time';
    } else {
      els.payBtn.textContent = 'Select a Service';
      els.gcashToggle.textContent = 'Select a Service';
    }
  }

  async function loadConfig() {
    const res = await fetch(CONFIG_URL, { cache: 'no-store' });
    state.config = await res.json();
    renderServices();
    const maxDate = new Date(manilaNow());
    maxDate.setDate(maxDate.getDate() + 60);
    els.dateInput.min = todayStr();
    els.dateInput.max = maxDate.toISOString().slice(0, 10);
  }

  async function loadAvailability() {
    try {
      const res = await fetch(AVAILABILITY_URL + '?t=' + Date.now(), { cache: 'no-store' });
      state.availability = res.ok ? await res.json() : {};
    } catch (err) {
      state.availability = {};
    }
  }

  function showError(msg) {
    els.formError.textContent = msg;
    els.formError.hidden = !msg;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  async function handleStripeSubmit({ fullName, phone, email }) {
    els.payBtn.disabled = true;
    els.gcashToggle.disabled = true;
    els.payBtn.classList.add('loading');

    try {
      const res = await fetch(VERCEL_API_BASE + '/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceIds: state.selectedServices.map((s) => s.id),
          date: state.selectedDate,
          time: state.selectedTime,
          fullName,
          phone,
          email,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Something went wrong — please try again.');
        if (res.status === 409) {
          await loadAvailability();
          renderSlots();
        }
        return;
      }

      window.location.href = data.url;
      return;
    } catch (err) {
      showError('Could not reach the payment service. Please check your connection and try again.');
    }

    els.payBtn.classList.remove('loading');
    updateSummary();
  }

  async function handleGcashSubmit({ fullName, phone, email }) {
    const file = els.gcashProof.files[0];
    if (!file) {
      showError('Please upload a screenshot of your GCash payment.');
      return;
    }
    if (!ALLOWED_PROOF_TYPES.includes(file.type)) {
      showError('Screenshot must be a JPG, PNG, or WEBP image.');
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      showError('That image is too large — please attach a screenshot under 4MB.');
      return;
    }

    els.gcashConfirmBtn.disabled = true;
    els.gcashConfirmBtn.classList.add('loading');

    try {
      const proofImageBase64 = await fileToBase64(file);
      const res = await fetch(VERCEL_API_BASE + '/api/create-gcash-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceIds: state.selectedServices.map((s) => s.id),
          date: state.selectedDate,
          time: state.selectedTime,
          fullName,
          phone,
          email,
          gcashReference: els.gcashReference.value.trim(),
          proofImageBase64,
          proofImageMimeType: file.type,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Something went wrong — please try again.');
        if (res.status === 409) {
          await loadAvailability();
          renderSlots();
        }
        return;
      }

      renderGcashPendingStatus();
      return;
    } catch (err) {
      showError('Could not reach the booking service. Please check your connection and try again.');
    }

    els.gcashConfirmBtn.disabled = false;
    els.gcashConfirmBtn.classList.remove('loading');
  }

  function renderGcashPendingStatus() {
    els.status.className = 'reserve-status pending';
    els.status.innerHTML =
      "<strong>Booking request received!</strong> We're verifying your GCash payment and will confirm your slot shortly — you'll get a text or call from us.";
    els.form.style.display = 'none';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    showError('');

    const fullName = els.name.value.trim();
    const phone = els.phone.value.trim();
    const email = els.email.value.trim();

    if (!state.selectedServices.length || !state.selectedDate || !state.selectedTime) {
      showError('Please choose at least one service, a date, and a time.');
      return;
    }
    if (!fullName || !phone || !email) {
      showError('Please fill in your name, phone, and email.');
      return;
    }

    // e.submitter is which <button type="submit"> was actually clicked —
    // that's how we know card (Stripe) vs GCash (manual transfer + proof).
    const provider = (e.submitter && e.submitter.dataset.provider) || 'stripe';

    if (provider === 'gcash') {
      await handleGcashSubmit({ fullName, phone, email });
    } else {
      await handleStripeSubmit({ fullName, phone, email });
    }
  }

  function renderReturnStatus() {
    const params = new URLSearchParams(window.location.search);
    const statusEl = els.status;

    if (params.get('success') === '1') {
      statusEl.className = 'reserve-status success';
      statusEl.innerHTML =
        "<strong>You're booked!</strong> Payment received — a receipt has been sent to your email. We'll see you at your reserved time.";
      els.form.style.display = 'none';
    } else if (params.get('canceled') === '1') {
      statusEl.className = 'reserve-status canceled';
      statusEl.textContent = 'Checkout was canceled — no payment was made. Feel free to try again below.';
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    els.serviceList = document.querySelector('[data-service-list]');
    els.dateInput = document.getElementById('reserve-date');
    els.slotGrid = document.querySelector('[data-slot-grid]');
    els.name = document.getElementById('reserve-name');
    els.phone = document.getElementById('reserve-phone');
    els.email = document.getElementById('reserve-email');
    els.totalAmount = document.querySelector('[data-total-amount]');
    els.payBtn = document.querySelector('[data-pay-btn]');
    els.gcashToggle = document.querySelector('[data-gcash-toggle]');
    els.gcashPanel = document.querySelector('[data-gcash-panel]');
    els.gcashAmount = document.querySelector('[data-gcash-amount]');
    els.gcashProof = document.getElementById('gcash-proof');
    els.gcashReference = document.getElementById('gcash-reference');
    els.gcashConfirmBtn = document.querySelector('[data-pay-btn-gcash-confirm]');
    els.gcashCopy = document.querySelector('[data-gcash-copy]');
    els.formError = document.querySelector('[data-form-error]');
    els.form = document.getElementById('reserve-form');
    els.status = document.getElementById('reserve-status');

    if (!els.form) return;

    els.dateInput.addEventListener('change', async () => {
      state.selectedDate = els.dateInput.value;
      await loadAvailability();
      renderSlots();
    });

    els.gcashToggle.addEventListener('click', () => {
      els.gcashPanel.hidden = !els.gcashPanel.hidden;
      if (!els.gcashPanel.hidden) {
        els.gcashPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    els.gcashCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(GCASH_NUMBER_DIGITS);
        els.gcashCopy.textContent = 'Copied!';
        setTimeout(() => { els.gcashCopy.textContent = 'Copy'; }, 1500);
      } catch (err) {
        // Clipboard API unavailable — the number is already visible to copy by hand.
      }
    });

    els.form.addEventListener('submit', handleSubmit);

    renderReturnStatus();
    await loadConfig();
  });
})();
