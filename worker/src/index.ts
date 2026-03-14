export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_API_KEY: string;
}

interface User {
  id: number;
  api_key: string;
  email: string | null;
  balance: number;
}

// --- Auth ---

async function authenticateUser(request: Request, db: D1Database): Promise<User | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const apiKey = auth.slice(7);
  const user = await db.prepare("SELECT * FROM users WHERE api_key = ?").bind(apiKey).first<User>();
  return user || null;
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
  await db.batch([
    db.prepare(
      "INSERT INTO usage_log (user_id, model, endpoint, prompt_tokens, completion_tokens, total_tokens) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userId, model, endpoint, promptTokens, completionTokens, totalTokens),
    db.prepare(
      "UPDATE users SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(totalTokens, userId),
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

  // Build headers: copy original headers, replace auth with real provider key
  const headers = new Headers(request.headers);
  headers.delete("Authorization"); // Remove user's VibPage key

  const authHeaders = config.getAuthHeaders(env);
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  // Forward request
  const providerRes = await fetch(targetUrl, {
    method: request.method,
    headers,
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
      COUNT(*) as requests
    FROM usage_log
    WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY model, endpoint
  `).bind(user.id, days).all();

  return jsonResponse({
    balance: user.balance,
    usage: stats.results,
  });
}

// --- Route: GET /api/me ---

async function handleMe(_request: Request, _env: Env, user: User): Promise<Response> {
  return jsonResponse({
    id: user.id,
    email: user.email,
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

    // All other routes require auth
    const user = await authenticateUser(request, env.DB);
    if (!user) {
      return errorResponse("Invalid or missing API key", 401);
    }

    // Check balance (allow checking usage/me even with 0 balance)
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

    return errorResponse("Not found", 404);
  },
};
