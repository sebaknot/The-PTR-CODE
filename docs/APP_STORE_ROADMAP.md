# Porter — Path to App Store Launch

_Prepared for the Porter founding team. Status as of this review._

This document explains (1) where the codebase actually stood when it was handed
over, (2) what has now been fixed, and (3) the concrete, sequenced plan to reach
a production, App-Store-ready, multi-tenant app that can safely carry thousands
of paying customers.

---

## 1. What we inherited (the honest baseline)

Porter is an "Uber for packages" — an Expo/React Native mobile app with a
sender and a porter (courier) experience, backed by an Express + PostgreSQL API,
with Stripe payments and a "Porter Box" locker feature.

There was real, working product here — but it was **prototype-grade**, and the
handoff was **incomplete**:

- **The project would not build as delivered.** The files had been flattened out
  of their monorepo structure into one folder, with many duplicates. The real
  layout had to be reconstructed.
- **The mobile app's entire foundation was missing.** The app's theme system
  (`ThemeContext`), auth/session state (`UserContext`), and 8 core UI components
  (payment sheet, address autocomplete, map modal, rating modal, delivery card,
  error boundary, Stripe wrappers) were referenced by every screen but **were not
  in the delivered code at all.** The app literally could not compile or run.
- **Multiple serious security holes** (see §2).
- **Zero automated tests, no CI.**
- **Only a single "Add files via upload" commit** — no development history was
  handed over. _You should still request the original repository with full git
  history; you paid for it, and it's the only way to audit the real work done._

None of this means the concept or the groundwork is worthless — the opposite.
But it was sold/perceived as further along than it was.

---

## 2. What has been fixed in this branch

### Structure
- Rebuilt the documented monorepo: `artifacts/{api-server, sender-app,
  mockup-sandbox}`, `lib/{db, api-zod, api-client-react, api-spec}`, `scripts`.
- Recreated the lost package manifests and the overwritten server entry point.
- Removed duplicate and dead files.

### Security (backend) — every hole found is now closed
| Issue | Before | After |
|---|---|---|
| Delivery ownership | Anyone could mark **any** delivery delivered/cancelled | Only the assigned porter (sender may cancel) |
| Job acceptance | Courier id taken from request body; double-accept race | Bound to authed user; **atomic** claim; porter-role gate |
| Create delivery | `senderId` taken from body | Bound to the authenticated user |
| Ratings | Anyone could rate any delivery | Sender-only, delivered orders only |
| Live tracking | Any user could track any delivery | Participants only |
| OTP codes | `Math.random`, 4 digits, no limits — brute-forceable | Crypto-secure **6-digit**, rate-limited |
| Rate limiting | None | Global + strict auth/OTP tiers |
| Headers / CORS | Wide open | `helmet`, CORS allowlist, body-size caps |
| Demo seeder | Public, unauthenticated | Gated behind a secret, off by default |
| Payment input | Untyped `as` casts | Validated with zod (bounded coords, capped strings) |

### Mobile app foundation (rebuilt from scratch)
- **Premium design system** (`ThemeContext`): deep navy + champagne-gold, full
  light/dark support, one source of truth every screen reads from. This is the
  "luxurious, elite" look, applied consistently rather than per-screen.
- **Secure session** (`UserContext`): tokens now stored in the device keychain
  via `expo-secure-store` (not plain AsyncStorage).
- Rebuilt all 8 missing components against their real usage contracts.
- **`app.json`** brought to submission standard: bundle ids, iOS/Android
  permission strings, premium splash, required Expo plugins.

### Verified
- `typecheck` is **green** across libs, api-server, and the mobile app.
- The API **production bundle builds** and **boots against PostgreSQL** —
  migrations apply, endpoints respond, and the security checks were confirmed
  live (unauthorized status change → 401; OTP is 6-digit; demo seeder → 404).

> ⚠️ The rebuilt mobile components are functionally complete and type-safe, but
> were reconstructed from how the screens use them. They still need **on-device
> QA** (iOS simulator + a physical device) before launch — that is normal for
> UI, and it's called out in Phase 1 below.

---

## 3. The plan to App Store launch

Estimated **8–12 focused engineering weeks** to a confident public launch,
depending on team size. Phases are ordered so each unblocks the next.

### Phase 0 — Recover & stabilize (0.5–1 wk)
- [ ] Obtain the **original repo + full git history** from the previous developer.
- [ ] Get the missing Mapbox token, Stripe keys, and any other secrets.
- [ ] Stand up environments (dev / staging / prod) with a managed Postgres.
- [ ] Confirm the app runs end-to-end in the iOS simulator.

### Phase 1 — Make every screen work on-device (2–3 wks)
- [ ] QA each reconstructed component on iOS + Android: booking wizard, payment
      sheet, live tracking, porter job flow, Porter Box flow, ratings.
- [ ] Wire a **crash/error reporter** (Sentry) — the `ErrorBoundary` has a hook
      ready for it.
- [ ] Replace 3.5s **polling** for live tracking with push/websockets before scale.
- [ ] Move package photos out of base64-in-DB to object storage (S3/GCS) with
      signed URLs.

### Phase 2 — Trust: testing & CI (2 wks, overlaps Phase 1)
- [ ] Unit tests for pricing, auth, and every authorization rule fixed in §2.
- [ ] Integration tests for the payment → delivery-creation flow (idempotency).
- [ ] E2E smoke tests (Detox/Maestro) for the core sender & porter journeys.
- [ ] **CI pipeline**: typecheck + tests + build on every PR (GitHub Actions).

### Phase 3 — Payments & compliance hardening (1–2 wks)
- [ ] Verify Stripe **webhook signature secret** is set in every environment.
- [ ] Move from Stripe **test** to **live** keys; test real payouts to porters
      (Stripe Connect if porters are paid through the platform).
- [ ] Refund / cancellation / dispute flows.
- [ ] **Legal**: Privacy Policy + Terms (required by Apple), data-deletion path,
      and a clear porter/independent-contractor agreement.

### Phase 4 — App Store & Play Store submission (1–2 wks)
- [ ] Apple Developer + Google Play accounts; **EAS Build** pipeline for signed
      binaries.
- [ ] App Store Connect listing: screenshots, description, support URL, privacy
      "nutrition label" (declare location, payments, contact data usage).
- [ ] Apple review readiness: Sign in with Apple is present ✓; ensure all
      permission prompts have clear justification strings (done in `app.json`).
- [ ] TestFlight beta with real users before public release.

### Phase 5 — Scale & "multinational" (ongoing)
- [ ] Multi-currency + localization (i18n) — pricing currently hard-coded USD.
- [ ] Region-aware pricing, tax/VAT handling per market.
- [ ] Load testing; database indexing and read replicas as volume grows.
- [ ] Observability: metrics, structured logs (pino is already in place),
      alerting, uptime monitoring.
- [ ] Fraud controls, porter background-check integration, insurance.

---

## 4. Biggest risks to watch
1. **Missing source history** — until you get the original repo, you can't fully
   audit what was built vs. paid for.
2. **Reconstructed UI needs device QA** — type-safe ≠ pixel-perfect on a phone.
3. **Real-time tracking via polling** won't scale to thousands of users as-is.
4. **Contractor/legal model** for porters is a launch blocker in most markets.
5. **No tests yet** — Phase 2 is non-negotiable before taking real money at scale.

---

## 5. Bottom line
You have a genuine foundation and, now, a **buildable, secured, professionally
themed** codebase — not a finished product, but a real starting line. The
fastest credible path to the App Store is the phased plan above; the two things
to start _today_ are recovering the original repository and standing up device QA.
