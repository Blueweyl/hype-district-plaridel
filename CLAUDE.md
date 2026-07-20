# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static marketing website for Hype District Barbers' Plaridel branch (a barbershop). Plain HTML/CSS/JS — no build step, no bundler, no framework. The site itself deploys as "serve the files as-is" on GitHub Pages (`https://blueweyl.github.io/hype-district-plaridel/`). The only server-side code is a small set of Vercel serverless functions under `api/` that power real online reservations + credit card payment (see "Online reservations" below) — everything else on the site remains pure static files with no backend.

## Running / previewing

There is no build or dev-server command. Open the HTML files directly in a browser, or serve the directory with any static file server, e.g.:

```
npx serve .
```

There is no lint or test suite configured. The `api/` serverless functions have a root `package.json` (only `stripe` as a dependency) — that's purely for the separate Vercel deploy described below and has no effect on the static site or GitHub Pages.

## Architecture

### Pages are independent, hand-duplicated HTML files

`index.html`, `services.html`, `reserve.html`, `gallery.html`, `about.html`, `contact.html`, `updates.html` each contain a full copy of the `<header class="site-header">` nav and `<footer class="site-footer">` markup — there is no templating/includes system. When changing the nav, footer, phone numbers, address, or social links, **update all seven HTML files**, not just one. Every "Book Now"/"Book Appointment" CTA sitewide links to `reserve.html`; `contact.html` is kept separate for general (non-booking) inquiries only.

### Styling

Single stylesheet at `css/style.css`, driven by CSS custom properties defined in `:root` (colors, radius, max width). Follow the existing token names (`--gold`, `--text-muted`, `--bg-panel`, etc.) rather than hardcoding new colors.

Placeholder photography uses a `.ph` (placeholder) div convention instead of real `<img>` tags, e.g.:
```html
<div class="ph tall" data-label="Barber at work / haircut in progress"></div>
```
`.ph` renders a styled box with the `data-label` text shown via `::after`. Modifier classes (`.tall`, `.square`, `.wide`, `.hero`) control aspect ratio. Replace these with real `<img>` tags as photos become available — don't remove the pattern for pages still awaiting images.

### `js/script.js` — page chrome behavior

Runs on every page: mobile nav toggle, FAQ accordion (on pages with `.faq-item`), header drop-shadow on scroll, and a demo-only contact form submit handler (`.contact-form`) that just shows an alert — it is **not** wired to any backend or email service.

### `js/updates.js` — client-side "Updates" feed

No backend. On pages with `[data-updates-full]` (updates.html) or `[data-updates-teaser]` (index.html), this script calls the **GitHub Contents API directly from the browser** to list and fetch JSON files under `content/updates/`, sorts them by `date` descending, and renders each as an embedded social post (Facebook/Instagram/TikTok, via each platform's embed JS) or a fallback card if no `link` was provided.

The repo owner/name/branch are hardcoded at the top of `js/updates.js` (`REPO`, `BRANCH`, `UPDATES_PATH`) and must match the actual GitHub repo the site is deployed from — currently `Blueweyl/hype-district-plaridel` on `master`. If the repo is renamed or forked, update these constants.

### `content/updates/*.json` — the update entries themselves

Each file is one update post, named `{{year}}-{{month}}-{{day}}-{{slug}}.json`, with fields `title`, `platform` (`facebook`/`instagram`/`tiktok`), `link`, `image`, `video`, `date`. These are the data files `js/updates.js` reads at runtime — adding a new JSON file here is how a new update goes live, no code change required.

### `admin/` — Decap CMS

A Decap CMS (formerly Netlify CMS) instance for non-technical editing of `content/updates/`. `admin/index.html` just loads the Decap CMS script; all configuration is in `admin/config.yml`, which points at:
- backend: `github`, repo `Blueweyl/hype-district-plaridel`, branch `master`
- `base_url`/`auth_endpoint`: an external OAuth proxy (`oauth-proxy-blush.vercel.app`) required because GitHub OAuth needs a server-side component that this static site doesn't otherwise have

The `updates` collection schema in `config.yml` must stay in sync with the fields `js/updates.js` expects to read from each JSON entry.

### Online reservations + payment (`reserve.html`, `js/reserve.js`, `api/`)

A real (non-demo) booking flow: pick a service, date, and time on `reserve.html`, then pay the full price by card via **Stripe Checkout** (Stripe's own hosted, PCI-compliant payment page — this site never touches raw card data or embeds Stripe.js/Elements). The flow is:

1. `js/reserve.js` renders services/hours from `content/booking-config.json` (fetched same-origin, static file — display/UX only, not trusted for pricing).
2. On date change, it fetches `content/availability.json` from `raw.githubusercontent.com` (not the GitHub API — avoids the 60 req/hr unauthenticated rate limit) to grey out already-booked slots.
3. On submit, it `POST`s the booking to `api/create-checkout-session` on a **separate Vercel deployment** of this same repo (`VERCEL_API_BASE` constant at the top of `js/reserve.js` — update it if that Vercel project's URL ever changes), which re-validates everything server-side (price comes from `content/booking-config.json` on the server, never from the client), re-checks the slot is free, creates a Stripe Checkout Session, and returns `{ url }` for the browser to redirect to.
4. Stripe calls `api/stripe-webhook` (signature-verified, `checkout.session.completed` only) once payment succeeds — **this is the only place a reservation is actually written**, never the client-side success redirect. It commits a JSON file to `content/reservations/{date}-{HHmm}.json` via the GitHub Contents API (write, no `sha` — so GitHub itself rejects a double-booked slot with a 422) and updates `content/availability.json`.

**Why a second Vercel project**: GitHub Pages can't run server code. Rather than migrating the site's hosting, `api/` is deployed as an independent Vercel project tracking this same GitHub repo — the same pattern already used for Decap CMS's OAuth proxy (`oauth-proxy-blush.vercel.app`, external, unrelated project). GitHub Pages remains the canonical live site, untouched.

**Privacy**: `content/reservations/*.json` is in a public repo (required for GitHub Pages + Decap CMS's unauthenticated reads to keep working), so by design it stores only `firstName` + `phoneLast4` — never full name, phone, or email. Full customer contact details live in the Stripe Dashboard (captured at checkout) — that's where the shop owner looks to actually call/confirm a customer. Keep any future change to the reservation schema consistent with this — don't start writing full PII into the repo.

**Env vars** (set in the Vercel project's dashboard, never committed): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GITHUB_TOKEN` (fine-grained PAT, Contents read/write, scoped to only this repo), `ALLOWED_ORIGIN` (CORS allow-list for `api/create-checkout-session`, e.g. `https://blueweyl.github.io`).

**Bookable services/prices/hours** live in `content/booking-config.json` (single source of truth, read by both client and server) — edit prices/services there, not in HTML. The 45-minute slot-generation loop itself is intentionally duplicated in `js/reserve.js` and `api/_lib/slots.js` (no bundler exists to share an ES module across the browser/Node boundary) — keep both in sync if the algorithm (not just the hours/prices data) ever changes. Business hours are fixed to `Asia/Manila` (UTC+8) on both sides regardless of visitor or server timezone.

The `reservations` collection in `admin/config.yml` (`create: false`, `delete: true`) lets the shop owner view/cancel bookings in Decap CMS the same way they manage `updates` — but bookings are only ever created by the webhook, never hand-authored there.

## Content notes

- Two locations exist: the Plaridel branch (this site's focus) and the original La Loma, Quezon City flagship. Contact info for both appears in every page footer and on `contact.html` — keep them distinguished when editing.
- Follower counts, taglines, and business copy on `index.html`/`about.html` reflect real social-media stats; don't invent numbers when editing copy.
