# Porter (formerly SwiftSend)

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.

## Porter App

**Uber/Lyft for packages** — single Expo app (`artifacts/sender-app`) with role-based sender/porter UX.

### Role-Based Routing
- `/onboarding` → `/(sender)` or `/(porter)` based on stored profile role
- Role stored in `AsyncStorage` via `UserContext`; DB stores role as `"courier"` internally (enum kept as-is)
- Auth via `POST /api/auth/login` → returns `{ token, user }`; token stored in AsyncStorage

### Key Features
- **Sender**: Home (greeting, "Where to?" pill, quick address tiles, Active Porters Mapbox map, active orders), Ports tab (5-step booking wizard: address → port-type → port-details → delivery-method → finding-porter), Orders (filtered list), Profile (membership level badge)
- **Porter (formerly Courier)**: Jobs (online/offline toggle, GPS, accept delivery), Active (Navigate button to open maps, Mark Picked Up/Delivered), History (earnings breakdown: today/week/total, avg/trip), Profile (Switch toggle for online status, real earnings/rating)
- **Live Tracking**: Full-screen map (react-native-maps on mobile, Mapbox static map on web), ETA pill that updates live via 3.5s polling
- **Demo**: `POST /api/demo/seed` creates NYC delivery (Times Square → Chelsea Market), animates courier through 7 waypoints every 4s, auto-updates status mid-route
- **Rating system**: 1–5 stars modal with comment + success animation; rolling average on courier profile

### Colors
- Primary: `#123E6B`, Accent: `#6FA3C8`, Teal: `#4E6F64`, Dark: `#0E0F12`, Secondary: `#8A96A3`, Border: `#DCE4EE`

### Stripe Payment Integration
- **Flow**: "Request Pickup" button → `PaymentBottomSheet` slides up → user taps Apple Pay (iOS) or "Continue with Priority" → Stripe Checkout URL opens in browser → delivery created after return
- **Backend**: `POST /api/payments/checkout-session` creates a Stripe Checkout Session and returns a URL. `GET /api/payments/config` returns the publishable key.
- **Stripe init**: `initStripe()` runs on server startup in `index.ts`: `runMigrations()` → `getStripeSync()` → `findOrCreateManagedWebhook()` → `syncBackfill()`
- **Webhook**: registered at `/api/stripe/webhook` BEFORE `express.json()` in `app.ts` using `express.raw()`
- **DB**: `stripe_customer_id TEXT` column added to `users` table; Stripe-managed tables live in the `stripe` schema (29 tables created by `stripe-replit-sync`)
- **Key files**: `stripeClient.ts`, `webhookHandlers.ts`, `routes/payments.ts`, `components/PaymentBottomSheet.tsx`
- **Integration**: Replit Stripe integration (sandbox) — credentials fetched at runtime via Replit Connectors API

### Porter Boxes (Secure Locker Delivery)
- `porter_boxes` DB table: `id, name, address, lat, lng, is_active, created_at`
- 7 SF box locations seeded
- `deliveries` extended: `delivery_type` (standard|porter_box), `porter_box_id`, `pickup_code`, `in_box` status
- Status flow for porter box deliveries: `pending → accepted → picked_up → in_box → delivered`
- Sender: chooses "Porter Box" service in booking; selects a box as dropoff
- Porter: sees "Drop at Porter Box" button (purple `#7C3AED`) when `delivery.deliveryType === "porter_box"` + `status === "picked_up"`; calls `POST /deliveries/:id/drop-at-box`
- Sender: "Services" tab → "Porter Box Pickup" → sees `in_box` packages with 6-char alphanumeric code; verifies pickup via code modal → `POST /porter-boxes/pickup`
- Pickup code shown on Porter's screen after drop-off confirmation alert

### Package Photos
- Senders can optionally take/upload a photo of their package during booking (between item details and delivery method steps)
- Photo captured via `expo-image-picker` — camera or gallery, 50% quality JPEG, 4:3 aspect
- After delivery is created (payment success), photo is uploaded via `POST /api/deliveries/:id/photo` as base64
- Photo stored as `data:image/jpeg;base64,...` in `deliveries.package_photo_url` column
- Porter's active delivery screen displays the photo prominently below the package description
- Photo is optional — booking proceeds normally if skipped

### API Endpoints (all under `/api`)
- `GET/POST /deliveries` — list (by sender/courier, nearby) / create
- `PATCH /deliveries/:id/status` — update delivery status
- `POST /deliveries/:id/rate` — rate a delivery (updates courier rolling avg)
- `POST /deliveries/:id/drop-at-box` — porter drops package; sets status=in_box, generates pickupCode
- `POST /porter-boxes/pickup` — sender confirms collection by code; sets status=delivered
- `GET /porter-boxes` — list active Porter Box locations (with optional lat/lng for distance sorting)
- `GET /tracking/:id` — real-time courier position + status
- `PATCH /couriers/:id/online` — toggle courier online status
- `POST /demo/seed` — seed demo delivery + animate courier
- `GET /payments/config` — return Stripe publishable key
- `POST /payments/intent` — create PaymentIntent with delivery metadata (native iOS/Android path), returns clientSecret + paymentIntentId
- `POST /payments/complete-intent` — verify PaymentIntent status === "succeeded", create delivery from metadata (native path)
- `POST /payments/checkout-session` — create Stripe Checkout Session with delivery metadata (web path), returns URL + sessionId
- `POST /payments/complete` — verify payment_status === "paid", create delivery from session metadata (web path)

### Environment Variables
- `EXPO_PUBLIC_MAPBOX_TOKEN` — Mapbox API token for geocoding + static maps
- `EXPO_PUBLIC_DOMAIN` — API server domain (set via `setBaseUrl` in `_layout.tsx`)
- `STRIPE_SECRET_KEY` — Stripe secret key (fallback if Replit Stripe connector not linked). Use `sk_test_...` for dev, `sk_live_...` for prod.
- `STRIPE_PUBLISHABLE_KEY` — Stripe publishable key (fallback). Use `pk_test_...` for dev, `pk_live_...` for prod.

**NOTE**: Stripe credentials are loaded in priority order: (1) Replit Stripe connector, (2) `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` env vars. The Replit connector (ccfg_stripe_01K611P4YQR0SZM11XFRQJC44Y) was dismissed by the user — env var fallback is now active. If re-connecting via the integration system is desired, propose `connector:ccfg_stripe_01K611P4YQR0SZM11XFRQJC44Y` again.

### Auth & UserContext
- `POST /api/auth/send-otp` — sends 4-digit code via Twilio (phone) or SendGrid (email); dev logs to console
- `POST /api/auth/verify-otp` — validates code, upserts user, creates session, returns `{ token, user, isNewUser }`
- `POST /api/auth/complete-profile` — sets `firstName` + `lastName` for new users (Bearer auth)
- `POST /api/auth/google` — verifies Google `idToken`, upserts user, returns session
- `POST /api/auth/apple` — verifies Apple `identityToken`, upserts user, returns session
- `POST /api/auth/login` — legacy deviceId-based login (kept for compatibility)
- `GET /api/auth/me` — validates Bearer token, returns fresh user
- `POST /api/auth/logout` — deletes session by token
- `sessionsTable` — `{ id, userId, token, expiresAt, createdAt }`, 30-day TTL
- `otpCodesTable` — `{ id, target, type, code, expiresAt, used, createdAt }`, 10-min TTL
- `usersTable` additions: `email`, `firstName`, `lastName`, `googleId`, `appleId` (all nullable)
- UserContext exports: `user`, `setUser`, `token`, `setToken`, `updateUser`, `logout`, `isLoading`
- `requireAuth` middleware exported from `auth.ts` for protecting routes

### Onboarding Flow (multi-step)
1. **Role selection** — Sender or Porter (Become a Porter)
2. **Auth screen** — phone number input + Continue button; divider + Apple (iOS only) / Google / Email buttons
3. **Email step** — email input when "Continue with Email" tapped
4. **OTP screen** — 4 digit boxes with auto-advance + 30s resend timer
5. **Welcome back** — animated 1.5s splash for returning users
6. **Name entry** — firstName + lastName for new users → PATCH via `/auth/complete-profile`
