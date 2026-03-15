import { createRemoteJWKSet, jwtVerify } from "jose";
import Stripe from "stripe";

export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_API_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_JWKS_URL: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

interface User {
  id: number;
  api_key: string;
  email: string | null;
  balance: number;
  clerk_user_id: string | null;
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

// --- Plan config ---

interface PlanConfig {
  credits: number;
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
}

const PLANS: Record<string, PlanConfig> = {
  "pay-as-you-go": { credits: 0 },
  hobby: { credits: 3000 },
  pro: { credits: 10000 },
  max: { credits: 20000 },
};

// --- Auth ---

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(env: Env) {
  if (!jwks) {
    const url = env.CLERK_JWKS_URL || "https://clerk.vibpage.com/.well-known/jwks.json";
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

async function authenticateUserByJWT(request: Request, env: Env): Promise<User | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);

  try {
    const { payload } = await jwtVerify(token, getJWKS(env));
    const clerkUserId = payload.sub;
    if (!clerkUserId) return null;

    // Look up existing user by clerk_user_id
    let user = await env.DB.prepare("SELECT * FROM users WHERE clerk_user_id = ?")
      .bind(clerkUserId)
      .first<User>();

    if (!user) {
      // Auto-create user on first login — fetch email from Clerk API
      let email: string | null = null;
      try {
        const clerkRes = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
          headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        });
        if (clerkRes.ok) {
          const clerkUser = await clerkRes.json() as Record<string, any>;
          const primary = clerkUser.email_addresses?.find(
            (e: any) => e.id === clerkUser.primary_email_address_id
          );
          email = primary?.email_address || null;
        }
      } catch { /* ignore, email stays null */ }

      const apiKey = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO users (api_key, email, balance, clerk_user_id, plan) VALUES (?, ?, 0, ?, 'free')"
      ).bind(apiKey, email, clerkUserId).run();

      user = await env.DB.prepare("SELECT * FROM users WHERE clerk_user_id = ?")
        .bind(clerkUserId)
        .first<User>();
    }

    return user || null;
  } catch {
    return null;
  }
}

async function authenticateUserByApiKey(request: Request, db: D1Database): Promise<User | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const apiKey = auth.slice(7);
  const user = await db.prepare("SELECT * FROM users WHERE api_key = ?").bind(apiKey).first<User>();
  return user || null;
}

async function authenticateUser(request: Request, env: Env): Promise<User | null> {
  // Try JWT first, then fall back to API key
  const user = await authenticateUserByJWT(request, env);
  if (user) return user;
  return authenticateUserByApiKey(request, env.DB);
}

// --- Credits pricing ---
// 1 credit = $0.01. Prices include 2x markup over provider cost.
// Per-million-token rates converted to per-token multipliers.

interface ModelPricing {
  inputCreditsPerToken: number;   // credits per input token
  outputCreditsPerToken: number;  // credits per output token
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI — GPT-5.4: cost $2.50/$15.00 per M → 2x = $5.00/$30.00 per M = 500/3000 credits per M
  "gpt-5.4":           { inputCreditsPerToken: 500 / 1_000_000, outputCreditsPerToken: 3000 / 1_000_000 },
  // GPT-4o: cost $2.50/$10.00 per M → 2x = $5.00/$20.00 per M
  "gpt-4o":            { inputCreditsPerToken: 500 / 1_000_000, outputCreditsPerToken: 2000 / 1_000_000 },
  "gpt-4o-2024-08-06": { inputCreditsPerToken: 500 / 1_000_000, outputCreditsPerToken: 2000 / 1_000_000 },
  // GPT-4o-mini: cost $0.15/$0.60 per M → 2x = $0.30/$1.20 per M
  "gpt-4o-mini":       { inputCreditsPerToken: 30 / 1_000_000, outputCreditsPerToken: 120 / 1_000_000 },
};

// Default pricing for unknown models (use GPT-4o rates as safe default)
const DEFAULT_PRICING: ModelPricing = { inputCreditsPerToken: 500 / 1_000_000, outputCreditsPerToken: 2000 / 1_000_000 };

function getModelPricing(model: string): ModelPricing {
  // Try exact match first, then prefix match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  return DEFAULT_PRICING;
}

function calculateCredits(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = getModelPricing(model);
  const credits = promptTokens * pricing.inputCreditsPerToken + completionTokens * pricing.outputCreditsPerToken;
  return Math.ceil(credits * 1000) / 1000; // round up to 3 decimal places
}

// --- Usage tracking ---

async function recordUsage(
  db: D1Database,
  userId: number,
  model: string,
  endpoint: string,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number
): Promise<void> {
  const creditsConsumed = calculateCredits(model, promptTokens, completionTokens);

  await db.batch([
    db.prepare(
      "INSERT INTO usage_log (user_id, model, endpoint, prompt_tokens, completion_tokens, total_tokens, credits_consumed) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(userId, model, endpoint, promptTokens, completionTokens, totalTokens, creditsConsumed),
    db.prepare(
      "UPDATE users SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(creditsConsumed, userId),
  ]);
}

// --- CORS ---

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// --- Provider config ---

interface ProviderConfig {
  baseUrl: string;
  getAuthHeaders: (env: Env) => Record<string, string>;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    baseUrl: "https://api.openai.com",
    getAuthHeaders: (env) => ({ Authorization: `Bearer ${env.OPENAI_API_KEY}` }),
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    getAuthHeaders: (env) => ({
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    }),
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com",
    getAuthHeaders: () => ({}), // Google uses key in URL
  },
};

// --- Extract usage from streaming SSE ---

async function extractUsageFromStream(
  stream: ReadableStream,
  provider: string
): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number; model: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let model = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (!model && parsed.model) model = parsed.model;

          // OpenAI format
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens || parsed.usage.input_tokens || promptTokens;
            completionTokens = parsed.usage.completion_tokens || parsed.usage.output_tokens || completionTokens;
            totalTokens = parsed.usage.total_tokens || 0;
          }
          // Anthropic format (message_delta event with usage)
          if (parsed.type === "message_start" && parsed.message?.usage) {
            promptTokens = parsed.message.usage.input_tokens || 0;
          }
          if (parsed.type === "message_delta" && parsed.usage) {
            completionTokens = parsed.usage.output_tokens || 0;
          }
        } catch {
          // Not JSON, skip
        }
      }
    }
  } catch {
    // Stream read error, ignore
  }

  if (!totalTokens && (promptTokens || completionTokens)) {
    totalTokens = promptTokens + completionTokens;
  }

  return { promptTokens, completionTokens, totalTokens, model };
}

// --- Route: Proxy to AI provider ---
// /proxy/{provider}/{path...} → forward to provider's API

async function handleProxy(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  user: User,
  provider: string,
  path: string
): Promise<Response> {
  const config = PROVIDERS[provider];
  if (!config) {
    return errorResponse(`Unknown provider: ${provider}`, 400);
  }

  // Build target URL
  let targetUrl = `${config.baseUrl}${path}`;

  // Google uses API key in URL
  if (provider === "google") {
    const separator = targetUrl.includes("?") ? "&" : "?";
    targetUrl += `${separator}key=${env.GOOGLE_API_KEY}`;
  }

  // Build headers: start fresh, copy content-type, add provider auth
  const forwardHeaders: Record<string, string> = {
    "Content-Type": request.headers.get("Content-Type") || "application/json",
  };

  // Copy any provider-specific headers from the original request (e.g. anthropic-version)
  for (const [key, value] of request.headers.entries()) {
    const lk = key.toLowerCase();
    if (lk.startsWith("anthropic-") || lk === "openai-organization") {
      forwardHeaders[key] = value;
    }
  }

  // Add real provider auth
  const authHeaders = config.getAuthHeaders(env);
  for (const [key, value] of Object.entries(authHeaders)) {
    forwardHeaders[key] = value;
  }

  // Forward request
  const providerRes = await fetch(targetUrl, {
    method: request.method,
    headers: forwardHeaders,
    body: request.body,
  });

  if (!providerRes.ok || !providerRes.body) {
    // Non-streaming error, pass through
    return new Response(providerRes.body, {
      status: providerRes.status,
      headers: { ...Object.fromEntries(providerRes.headers.entries()), ...corsHeaders() },
    });
  }

  const contentType = providerRes.headers.get("Content-Type") || "";
  const isStreaming = contentType.includes("text/event-stream") || contentType.includes("stream");

  if (isStreaming && providerRes.body) {
    // Tee the stream: one for client, one for usage tracking
    const [clientStream, usageStream] = providerRes.body.tee();

    ctx.waitUntil(
      extractUsageFromStream(usageStream, provider).then((usage) => {
        if (usage.totalTokens > 0) {
          return recordUsage(
            env.DB, user.id, usage.model || provider, `proxy/${provider}`,
            usage.promptTokens, usage.completionTokens, usage.totalTokens
          );
        }
      })
    );

    return new Response(clientStream, {
      status: providerRes.status,
      headers: {
        "Content-Type": contentType,
        ...corsHeaders(),
      },
    });
  }

  // Non-streaming response — read, extract usage, forward
  const result = await providerRes.json() as Record<string, any>;

  // Extract usage from non-streaming response
  const usage = result.usage;
  if (usage) {
    const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const completionTokens = usage.completion_tokens || usage.output_tokens || 0;
    const total = usage.total_tokens || (promptTokens + completionTokens);
    const model = result.model || provider;

    ctx.waitUntil(
      recordUsage(env.DB, user.id, model, `proxy/${provider}`, promptTokens, completionTokens, total)
    );
  }

  return jsonResponse(result);
}

// --- Route: GET /api/usage ---

async function handleUsage(request: Request, env: Env, user: User): Promise<Response> {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "30");

  const stats = await env.DB.prepare(`
    SELECT
      model,
      endpoint,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(credits_consumed) as credits_consumed,
      COUNT(*) as requests
    FROM usage_log
    WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY model, endpoint
  `).bind(user.id, days).all();

  return jsonResponse({
    balance: user.balance,
    plan: user.plan,
    usage: stats.results,
  });
}

// --- Route: GET /api/me ---

async function handleMe(_request: Request, _env: Env, user: User): Promise<Response> {
  return jsonResponse({
    id: user.id,
    email: user.email,
    balance: user.balance,
    plan: user.plan,
  });
}

// --- Route: POST /api/checkout ---

async function handleCheckout(request: Request, env: Env, user: User): Promise<Response> {
  const body = await request.json() as { plan: string; period?: string };
  const planName = body.plan?.toLowerCase();
  const period = body.period || "monthly";

  if (!planName || !PLANS[planName]) {
    return errorResponse("Invalid plan", 400);
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);

  // Create or reuse Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email || undefined,
      metadata: { clerk_user_id: user.clerk_user_id || "", vibpage_user_id: String(user.id) },
    });
    customerId = customer.id;
    await env.DB.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?")
      .bind(customerId, user.id).run();
  }

  // Look up price from Stripe by plan name + period
  // Prices should be created in Stripe dashboard with metadata: plan=xxx, period=monthly|yearly
  const prices = await stripe.prices.search({
    query: `metadata["plan"]:"${planName}" metadata["period"]:"${period}" active:"true"`,
  });

  if (!prices.data.length) {
    return errorResponse(`No Stripe price found for plan: ${planName} (${period})`, 404);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: prices.data[0].id, quantity: 1 }],
    success_url: "https://vibpage.pages.dev/checkout/success",
    cancel_url: "https://vibpage.pages.dev/checkout/cancel",
    metadata: {
      clerk_user_id: user.clerk_user_id || "",
      vibpage_user_id: String(user.id),
      plan: planName,
    },
  });

  return jsonResponse({ url: session.url });
}

// --- Route: POST /api/webhook/stripe ---

async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) return errorResponse("Missing signature", 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return errorResponse("Invalid signature", 400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = parseInt(session.metadata?.vibpage_user_id || "0");
    const plan = session.metadata?.plan || "free";
    const subscriptionId = session.subscription as string;

    if (userId && plan && PLANS[plan]) {
      await env.DB.prepare(
        "UPDATE users SET plan = ?, stripe_subscription_id = ?, balance = balance + ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(plan, subscriptionId, PLANS[plan].credits, userId).run();
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
    const userId = customer.metadata?.vibpage_user_id;
    if (userId) {
      await env.DB.prepare(
        "UPDATE users SET plan = 'free', stripe_subscription_id = NULL, updated_at = datetime('now') WHERE id = ?"
      ).bind(parseInt(userId)).run();
    }
  }

  return jsonResponse({ received: true });
}

// --- Route: POST /api/auth/token ---
// Exchange Clerk session token for a long-lived API token (for CLI)

async function handleAuthToken(request: Request, env: Env): Promise<Response> {
  const user = await authenticateUserByJWT(request, env);
  if (!user) return errorResponse("Invalid token", 401);

  return jsonResponse({
    api_key: user.api_key,
    email: user.email,
    plan: user.plan,
    balance: user.balance,
  });
}

// --- Main router ---

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check (no auth)
    if (path === "/" || path === "/health") {
      return jsonResponse({ status: "ok", service: "vibpage-api" });
    }

    // Stripe webhook (no auth — verified by signature)
    if (path === "/api/webhook/stripe" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }

    // Auth token exchange (JWT → API key, for CLI login)
    if (path === "/api/auth/token" && request.method === "POST") {
      return handleAuthToken(request, env);
    }

    // All other routes require auth
    const user = await authenticateUser(request, env);
    if (!user) {
      return errorResponse("Invalid or missing credentials", 401);
    }

    // Check balance (allow checking usage/me/checkout even with 0 balance)
    if (user.balance <= 0 && !path.startsWith("/api/")) {
      return errorResponse("Insufficient balance. Please top up your account.", 402);
    }

    // /proxy/{provider}/{rest...}
    const proxyMatch = path.match(/^\/proxy\/(openai|anthropic|google)(\/.*)/);
    if (proxyMatch && request.method === "POST") {
      return handleProxy(request, env, ctx, user, proxyMatch[1], proxyMatch[2]);
    }

    // API routes
    if (path === "/api/usage" && request.method === "GET") {
      return handleUsage(request, env, user);
    }
    if (path === "/api/me" && request.method === "GET") {
      return handleMe(request, env, user);
    }
    if (path === "/api/checkout" && request.method === "POST") {
      return handleCheckout(request, env, user);
    }

    return errorResponse("Not found", 404);
  },
};
