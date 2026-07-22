/* Reservation + payment flow. No card fields live on this page at all —
   the server creates a Stripe Checkout Session and this script just
   redirects to Stripe's own hosted, PCI-compliant payment page. The
   booking is only ever confirmed by the server-side Stripe webhook, never
   by this page's success redirect alone. */

(function () {
  const VERCEL_API_BASE = 'https://hype-district-plaridel.vercel.app';
  const CONFIG_URL = 'content/booking-config.json';
  const AVAILABILITY_URL =
    'https://raw.githubusercontent.com/Blueweyl/hype-district-plaridel/master/content/availability.json';

  const state = {
    config: null,
    availability: {},
    selectedService: null,
    selectedDate: null,
    selectedTime: null,
  };

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
        '<input type="radio" name="service" value="' + service.id + '">' +
        '<span class="service-pill-name">' + service.name + '</span>' +
        '<span class="service-pill-price">' + formatPeso(service.price) + '</span>';
      label.querySelector('input').addEventListener('change', () => selectService(service));
      list.appendChild(label);
    });
  }

  function selectService(service) {
    state.selectedService = service;
    els.serviceList.querySelectorAll('.service-pill').forEach((el) => {
      el.classList.toggle('selected', el.dataset.serviceId === service.id);
    });
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
    const ready = state.selectedService && state.selectedDate && state.selectedTime;
    els.totalAmount.textContent = state.selectedService ? formatPeso(state.selectedService.price) : '₱0';

    els.payBtn.disabled = !ready;
    els.payBtnGcash.disabled = !ready;

    if (ready) {
      els.payBtn.textContent = 'Pay with Card — ' + formatPeso(state.selectedService.price);
      els.payBtnGcash.textContent = 'Pay with GCash — ' + formatPeso(state.selectedService.price);
    } else if (state.selectedService) {
      els.payBtn.textContent = 'Pick a date & time';
      els.payBtnGcash.textContent = 'Pick a date & time';
    } else {
      els.payBtn.textContent = 'Select a Service';
      els.payBtnGcash.textContent = 'Select a Service';
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

  const PROVIDER_ENDPOINTS = {
    stripe: '/api/create-checkout-session',
    paymongo: '/api/create-paymongo-checkout',
  };

  async function handleSubmit(e) {
    e.preventDefault();
    showError('');

    const fullName = els.name.value.trim();
    const phone = els.phone.value.trim();
    const email = els.email.value.trim();

    if (!state.selectedService || !state.selectedDate || !state.selectedTime) {
      showError('Please choose a service, date, and time.');
      return;
    }
    if (!fullName || !phone || !email) {
      showError('Please fill in your name, phone, and email.');
      return;
    }

    // e.submitter is which of the two <button type="submit"> was actually
    // clicked — that's how we know card (Stripe) vs GCash (PayMongo).
    const provider = (e.submitter && e.submitter.dataset.provider) || 'stripe';
    const endpoint = PROVIDER_ENDPOINTS[provider];
    const clickedBtn = provider === 'paymongo' ? els.payBtnGcash : els.payBtn;

    els.payBtn.disabled = true;
    els.payBtnGcash.disabled = true;
    clickedBtn.classList.add('loading');

    try {
      const res = await fetch(VERCEL_API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: state.selectedService.id,
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

    clickedBtn.classList.remove('loading');
    updateSummary();
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
    els.payBtnGcash = document.querySelector('[data-pay-btn-gcash]');
    els.formError = document.querySelector('[data-form-error]');
    els.form = document.getElementById('reserve-form');
    els.status = document.getElementById('reserve-status');

    if (!els.form) return;

    els.dateInput.addEventListener('change', async () => {
      state.selectedDate = els.dateInput.value;
      await loadAvailability();
      renderSlots();
    });

    els.form.addEventListener('submit', handleSubmit);

    renderReturnStatus();
    await loadConfig();
  });
})();
