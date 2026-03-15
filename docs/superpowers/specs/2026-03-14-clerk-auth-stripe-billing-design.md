# Clerk Authentication + Stripe Billing Design

## Goal

Add user authentication (Google, Microsoft, Apple OAuth via Clerk) to the website and CLI, and integrate Stripe for subscription billing.

## Architecture

Three integration points: static Astro website (Clerk UI + Stripe redirect), CLI (localhost callback login), and Cloudflare Worker (JWT validation + Stripe Checkout/Webhook).

## Decisions

- **Auth provider**: Clerk (free tier, 50K MAU)
- **OAuth providers**: Google, Microsoft, Apple
- **CLI login**: Browser redirect with localhost HTTP callback (like `gh auth login`)
- **Payments**: Stripe Checkout (hosted), sessions created by Worker
- **No web dashboard**: Usage/plan info viewed in CLI
- **Website stays static**: All server logic in existing vibpage-api Worker

## Components

### 1. Website (VibPageSite)

**New dependencies**: `@clerk/astro`

**New pages**:
- `/login` — Clerk sign-in component
- `/signup` — Clerk sign-up component
- `/checkout/success` — Post-payment success page
- `/checkout/cancel` — Payment cancelled page

**Modified components**:
- `Header.astro` — Show user state (signed in/out) via Clerk
- `Pricing.astro` — CTA buttons: unauthenticated → `/signup`, authenticated → call Worker to create Stripe Checkout Session → redirect

**Login page must support CLI callback**: Accept `redirect_uri` query param. After successful Clerk auth, redirect to `redirect_uri` with session token.

### 2. CLI

**New command**: `vibpage login`
1. Start local HTTP server on random available port
2. Open browser to `https://vibpage.pages.dev/login?redirect_uri=http://localhost:PORT/callback`
3. Browser completes OAuth, site redirects to localhost callback with token
4. CLI receives token, saves to `~/.vibpage/config.json`
5. Local server shuts down

**Config changes**:
```typescript
interface VibPageConfig {
  // existing fields...
  authToken?: string;       // Clerk session/JWT token
  tokenExpiresAt?: string;  // Token expiry
}
```

**Auth flow in requests**: Use `authToken` as Bearer token instead of `vibpageApiKey` when available.

### 3. Worker (vibpage-api)

**New dependencies**: `jose` (JWT verification)

**Auth changes**:
- Primary: Verify Clerk JWT using JWKS endpoint
- Fallback: Existing API key auth (backward compat)
- On first JWT auth, auto-create user record with `clerk_user_id`

**New routes**:
- `POST /api/checkout` — Create Stripe Checkout Session
  - Input: `{ plan: string }`
  - Requires auth
  - Returns: `{ url: string }` (Stripe Checkout URL)
- `POST /api/webhook/stripe` — Stripe webhook handler
  - Validates Stripe signature
  - On `checkout.session.completed`: update user plan + add credits
  - On `customer.subscription.updated/deleted`: update plan status
- `GET /api/me` — Already exists, add plan info to response

**New secrets** (wrangler secret):
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWKS_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### 4. Database Migration (003_auth.sql)

```sql
ALTER TABLE users ADD COLUMN clerk_user_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
```

## Authentication Flow

```
CLI Login:
  vibpage login
  → open browser: /login?redirect_uri=http://localhost:PORT/callback
  → user signs in with Google/MS/Apple via Clerk
  → Clerk redirects to localhost:PORT/callback?token=xxx
  → CLI saves token to ~/.vibpage/config.json

Website Login:
  → user clicks Sign In
  → Clerk sign-in component (Google/MS/Apple)
  → session stored in browser

API Request Auth:
  → Bearer token (JWT) in Authorization header
  → Worker verifies JWT with Clerk JWKS
  → Extract clerk_user_id from JWT claims
  → Look up or create user in D1
  → Process request
```

## Subscription Flow

```
User clicks plan CTA (website):
  → POST /api/checkout { plan: "pro" }
  → Worker creates Stripe Checkout Session with:
    - price_id mapped from plan name
    - success_url: /checkout/success
    - cancel_url: /checkout/cancel
    - clerk_user_id in metadata
  → Return Stripe Checkout URL
  → Redirect user to Stripe

Stripe webhook (after payment):
  → POST /api/webhook/stripe
  → Verify signature
  → Extract clerk_user_id from metadata
  → Update user: plan, stripe_customer_id, stripe_subscription_id
  → Set monthly credits based on plan
```

## Plan-to-Credits Mapping

| Plan | Monthly Price | Yearly Price | Credits/Month |
|------|--------------|--------------|---------------|
| Pay As You Go | $20 | $16 | 0 (BYOK) |
| Hobby | $30 | $24 | 3,000 |
| Pro | $100 | $80 | 10,000 |
| Max | $200 | $160 | 20,000 |
