# QR Code Remote Control Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to control the VibPage CLI from their phone by scanning a QR code displayed in the terminal.

**Architecture:** CLI connects to a Cloudflare Durable Object via WebSocket, displays a QR code. Phone scans the code, opens a web page that connects to the same DO. Messages relay bidirectionally. CLI locks terminal input while phone is connected.

**Tech Stack:** Cloudflare Durable Objects (WebSocket), qrcode-terminal (CLI QR display), Astro static page (phone UI), existing Worker infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-15-qr-remote-control-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `worker/src/remote-session.ts` | Create | Durable Object class: manages CLI↔mobile WebSocket relay |
| `worker/src/index.ts` | Modify | Add `/api/remote/:sessionId` WebSocket upgrade route, export DO class |
| `worker/wrangler.toml` | Modify | Add Durable Object binding and migration |
| `src/remote.ts` | Create | CLI-side WebSocket client, QR code display, event forwarding |
| `src/ui.tsx` | Modify | Add `/remote` command, input locking, integrate remote module |
| `VibPageSite/src/pages/remote.astro` | Create | Phone chat page with WebSocket client |

---

## Chunk 1: Worker Durable Object

### Task 1: Configure Durable Object in wrangler.toml

**Files:**
- Modify: `worker/wrangler.toml`

- [ ] **Step 1: Add DO binding and migration**

Add to the end of `worker/wrangler.toml`:

```toml
[durable_objects]
bindings = [
  { name = "REMOTE_SESSION", class_name = "RemoteSession" }
]

[[migrations]]
tag = "v1"
new_classes = ["RemoteSession"]
```

- [ ] **Step 2: Verify config is valid**

Run: `cd worker && npx wrangler deploy --dry-run 2>&1 | head -20`
Expected: No config errors (may show other warnings, but no "unknown binding" or "invalid migration" errors).

- [ ] **Step 3: Commit**

```bash
git add worker/wrangler.toml
git commit -m "chore: add RemoteSession Durable Object config"
```

---

### Task 2: Implement RemoteSession Durable Object

**Files:**
- Create: `worker/src/remote-session.ts`

- [ ] **Step 1: Create the Durable Object class**

```typescript
// worker/src/remote-session.ts
// Durable Object that relays WebSocket messages between CLI and mobile

export class RemoteSession {
  private state: DurableObjectState;
  private cliSocket: WebSocket | null = null;
  private mobileSocket: WebSocket | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    if (role !== "cli" && role !== "mobile") {
      return new Response("Missing role param (cli or mobile)", { status: 400 });
    }

    // Reject second mobile connection
    if (role === "mobile" && this.mobileSocket) {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      server.close(4001, "Session already has a mobile connection");
      return new Response(null, { status: 101, webSocket: client });
    }

    // Origin check for mobile connections
    if (role === "mobile") {
      const origin = request.headers.get("Origin") || "";
      if (origin && !origin.includes("vibpage.com") && !origin.includes("localhost")) {
        return new Response("Origin not allowed", { status: 403 });
      }
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    if (role === "cli") {
      this.cliSocket = server;
    } else {
      this.mobileSocket = server;
      // Notify CLI that mobile connected
      this.send(this.cliSocket, { type: "connected", from: "mobile" });
    }

    // Reset idle alarm — session is active
    await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);

    server.addEventListener("message", (event) => {
      const target = role === "cli" ? this.mobileSocket : this.cliSocket;
      if (target) {
        try {
          target.send(typeof event.data === "string" ? event.data : "");
        } catch {
          // Target socket closed
        }
      }
    });

    server.addEventListener("close", () => {
      if (role === "cli") {
        this.cliSocket = null;
        this.send(this.mobileSocket, { type: "disconnected", from: "cli" });
        // CLI gone — close mobile too
        this.closeMobile();
      } else {
        this.mobileSocket = null;
        this.send(this.cliSocket, { type: "disconnected", from: "mobile" });
      }
      // Set idle alarm if both disconnected
      if (!this.cliSocket && !this.mobileSocket) {
        this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
      }
    });

    server.addEventListener("error", () => {
      if (role === "cli") {
        this.cliSocket = null;
        this.send(this.mobileSocket, { type: "disconnected", from: "cli" });
        this.closeMobile();
      } else {
        this.mobileSocket = null;
        this.send(this.cliSocket, { type: "disconnected", from: "mobile" });
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    // Idle timeout — close everything
    this.closeAll();
  }

  private send(socket: WebSocket | null, data: Record<string, unknown>): void {
    if (socket) {
      try {
        socket.send(JSON.stringify(data));
      } catch {
        // Socket closed
      }
    }
  }

  private closeMobile(): void {
    if (this.mobileSocket) {
      try { this.mobileSocket.close(1000, "CLI disconnected"); } catch {}
      this.mobileSocket = null;
    }
  }

  private closeAll(): void {
    if (this.cliSocket) {
      try { this.cliSocket.close(1000, "Session expired"); } catch {}
      this.cliSocket = null;
    }
    this.closeMobile();
  }
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd worker && npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/remote-session.ts
git commit -m "feat: add RemoteSession Durable Object for WebSocket relay"
```

---

### Task 3: Add WebSocket upgrade route to Worker

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add REMOTE_SESSION to Env interface**

In `worker/src/index.ts`, find the `Env` interface and add:

```typescript
REMOTE_SESSION: DurableObjectNamespace;
```

- [ ] **Step 2: Add WebSocket upgrade route**

In the `fetch` handler, before the 404 fallback (`return errorResponse("Not found", 404)`), add:

```typescript
    // /api/remote/:sessionId — WebSocket upgrade for remote control
    const remoteMatch = path.match(/^\/api\/remote\/([a-zA-Z0-9-]+)$/);
    if (remoteMatch && request.headers.get("Upgrade") === "websocket") {
      const sessionId = remoteMatch[1];
      const id = env.REMOTE_SESSION.idFromName(sessionId);
      const stub = env.REMOTE_SESSION.get(id);
      return stub.fetch(request);
    }
```

- [ ] **Step 3: Export the Durable Object class**

At the bottom of `worker/src/index.ts`, add the re-export:

```typescript
export { RemoteSession } from "./remote-session.js";
```

- [ ] **Step 4: Build to verify**

Run: `cd worker && npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: add /api/remote WebSocket upgrade route"
```

---

## Chunk 2: CLI Remote Module

### Task 4: Install qrcode-terminal dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `npm install qrcode-terminal`

- [ ] **Step 2: Install types if available**

Run: `npm install -D @types/qrcode-terminal 2>/dev/null || echo "No types package, will use declare module"`

If no types package exists, create a declaration. Check if `node_modules/qrcode-terminal/index.d.ts` exists. If not, add to `src/remote.ts` (in next task).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add qrcode-terminal dependency"
```

---

### Task 5: Create CLI remote module

**Files:**
- Create: `src/remote.ts`

- [ ] **Step 1: Create the remote module**

```typescript
// src/remote.ts
// CLI-side WebSocket client for QR code remote control

import WebSocket from "ws";
import qrcode from "qrcode-terminal";
import { randomUUID } from "crypto";
import { loadConfig } from "./config.js";

// Type declaration if qrcode-terminal has no types
declare module "qrcode-terminal" {
  export function generate(text: string, opts?: { small?: boolean }, cb?: (qr: string) => void): void;
}

export type RemoteEventHandler = (event: RemoteEvent) => void;

export interface RemoteEvent {
  type: "connected" | "disconnected" | "prompt" | "error";
  text?: string;
  from?: string;
  message?: string;
}

export interface RemoteSession {
  sessionId: string;
  ws: WebSocket;
  send: (data: Record<string, unknown>) => void;
  close: () => void;
}

const REMOTE_TEXTS: Record<string, {
  scanning: string;
  orVisit: string;
  connected: string;
  disconnected: string;
  connectionLost: string;
  alreadyActive: string;
}> = {
  "zh-CN": {
    scanning: "扫描二维码连接手机遥控",
    orVisit: "或访问",
    connected: "手机已连接，终端输入已锁定",
    disconnected: "手机已断开，终端输入已恢复",
    connectionLost: "远程连接丢失",
    alreadyActive: "远程会话已激活",
  },
  "zh-TW": {
    scanning: "掃描 QR Code 連接手機遙控",
    orVisit: "或訪問",
    connected: "手機已連接，終端輸入已鎖定",
    disconnected: "手機已斷開，終端輸入已恢復",
    connectionLost: "遠程連接丟失",
    alreadyActive: "遠程會話已激活",
  },
  en: {
    scanning: "Scan QR code to connect phone remote",
    orVisit: "Or visit",
    connected: "Phone connected, terminal input locked",
    disconnected: "Phone disconnected, terminal input restored",
    connectionLost: "Remote connection lost",
    alreadyActive: "Remote session already active",
  },
  fr: {
    scanning: "Scannez le QR code pour connecter la télécommande",
    orVisit: "Ou visitez",
    connected: "Téléphone connecté, saisie terminale verrouillée",
    disconnected: "Téléphone déconnecté, saisie terminale restaurée",
    connectionLost: "Connexion distante perdue",
    alreadyActive: "Session distante déjà active",
  },
  de: {
    scanning: "QR-Code scannen um Handy-Fernsteuerung zu verbinden",
    orVisit: "Oder besuchen Sie",
    connected: "Handy verbunden, Terminal-Eingabe gesperrt",
    disconnected: "Handy getrennt, Terminal-Eingabe wiederhergestellt",
    connectionLost: "Fernverbindung verloren",
    alreadyActive: "Fernsitzung bereits aktiv",
  },
  es: {
    scanning: "Escanea el código QR para conectar el control remoto",
    orVisit: "O visita",
    connected: "Teléfono conectado, entrada de terminal bloqueada",
    disconnected: "Teléfono desconectado, entrada de terminal restaurada",
    connectionLost: "Conexión remota perdida",
    alreadyActive: "Sesión remota ya activa",
  },
  pt: {
    scanning: "Escaneie o QR code para conectar o controle remoto",
    orVisit: "Ou visite",
    connected: "Celular conectado, entrada do terminal bloqueada",
    disconnected: "Celular desconectado, entrada do terminal restaurada",
    connectionLost: "Conexão remota perdida",
    alreadyActive: "Sessão remota já ativa",
  },
  ko: {
    scanning: "QR 코드를 스캔하여 휴대폰 리모컨 연결",
    orVisit: "또는 방문",
    connected: "휴대폰 연결됨, 터미널 입력 잠금",
    disconnected: "휴대폰 연결 해제, 터미널 입력 복원",
    connectionLost: "원격 연결 끊김",
    alreadyActive: "원격 세션 이미 활성화됨",
  },
  ja: {
    scanning: "QRコードをスキャンしてスマホリモコンを接続",
    orVisit: "またはアクセス",
    connected: "スマホ接続済み、ターミナル入力ロック中",
    disconnected: "スマホ切断、ターミナル入力復元",
    connectionLost: "リモート接続が切断されました",
    alreadyActive: "リモートセッションは既にアクティブです",
  },
};

export function getRemoteTexts(lang: string) {
  return REMOTE_TEXTS[lang] || REMOTE_TEXTS["en"];
}

let activeSession: RemoteSession | null = null;

export function isRemoteActive(): boolean {
  return activeSession !== null;
}

export function getActiveSession(): RemoteSession | null {
  return activeSession;
}

export function generateQrCode(url: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (qr: string) => {
      resolve(qr);
    });
  });
}

export async function startRemoteSession(
  lang: string,
  onEvent: RemoteEventHandler
): Promise<RemoteSession | null> {
  if (activeSession) {
    return null; // Already active
  }

  const config = loadConfig();
  if (!config.proxyUrl) {
    onEvent({ type: "error", message: "Proxy URL not configured. Please login first." });
    return null;
  }

  const sessionId = randomUUID();
  const wsUrl = config.proxyUrl.replace("https://", "wss://").replace("http://", "ws://")
    + `/api/remote/${sessionId}?role=cli`;

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${config.vibpageApiKey}` },
    });

    const session: RemoteSession = {
      sessionId,
      ws,
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data));
        }
      },
      close: () => {
        activeSession = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      },
    };

    ws.on("open", () => {
      activeSession = session;
      resolve(session);
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        onEvent(msg as RemoteEvent);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      if (activeSession === session) {
        activeSession = null;
        onEvent({ type: "disconnected", from: "server" });
      }
    });

    ws.on("error", () => {
      if (activeSession === session) {
        activeSession = null;
        onEvent({ type: "error", message: "WebSocket connection failed" });
      }
      resolve(null);
    });
  });
}

export function stopRemoteSession(): void {
  if (activeSession) {
    activeSession.close();
    activeSession = null;
  }
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build 2>&1`
Expected: No errors. (May need to adjust imports if `ws` is not available — check if project uses native WebSocket or `ws` package.)

Note: If `ws` is not a dependency, use the native `WebSocket` global (available in Node 22+). Replace `import WebSocket from "ws"` with just using global `WebSocket`, and remove the `headers` option (use URL params for auth instead).

- [ ] **Step 3: Commit**

```bash
git add src/remote.ts
git commit -m "feat: add CLI remote control module with QR code"
```

---

### Task 6: Integrate remote into CLI UI

**Files:**
- Modify: `src/ui.tsx`

- [ ] **Step 1: Add `/remote` to SLASH_COMMANDS**

Find the `SLASH_COMMANDS` array in `src/ui.tsx` and add a new entry (before `/help`):

```typescript
{
  name: "/remote",
  description: {
    "zh-CN": "手机遥控 (扫码连接)",
    "zh-TW": "手機遙控 (掃碼連接)",
    en: "Phone remote (scan QR)",
    fr: "Télécommande (scanner QR)",
    de: "Handy-Fernsteuerung (QR scannen)",
    es: "Control remoto (escanear QR)",
    pt: "Controle remoto (escanear QR)",
    ko: "휴대폰 리모컨 (QR 스캔)",
    ja: "スマホリモコン (QRスキャン)",
  },
  prompt: "",
},
```

- [ ] **Step 2: Add remote state and imports**

Add imports at the top of `src/ui.tsx`:

```typescript
import {
  startRemoteSession,
  stopRemoteSession,
  isRemoteActive,
  getActiveSession,
  generateQrCode,
  getRemoteTexts,
  type RemoteEvent,
} from "./remote.js";
```

Add state inside the main component (near other useState declarations):

```typescript
const [isRemoteLocked, setIsRemoteLocked] = useState(false);
```

- [ ] **Step 3: Add `/remote` command handler**

In the `executeCommand` function, add handling for `/remote` (before the `/help` check):

```typescript
if (cmd.name === "/remote") {
  const texts = getRemoteTexts(currentLang);

  if (isRemoteActive()) {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "system", text: texts.alreadyActive },
    ]);
    return;
  }

  setMessages((prev) => [
    ...prev,
    { id: nextId(), role: "system", text: texts.scanning },
  ]);

  const session = await startRemoteSession(currentLang, async (event: RemoteEvent) => {
    if (event.type === "connected" && event.from === "mobile") {
      setIsRemoteLocked(true);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "system", text: texts.connected },
      ]);
    } else if (event.type === "disconnected") {
      setIsRemoteLocked(false);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "system", text: texts.disconnected },
      ]);
    } else if (event.type === "prompt" && event.text) {
      // Execute prompt from phone
      const promptText = event.text.slice(0, 2000); // Length limit
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: `📱 ${promptText}` },
      ]);
      await sendPrompt(promptText);
    } else if (event.type === "error") {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "system", text: event.message || texts.connectionLost },
      ]);
      setIsRemoteLocked(false);
    }
  });

  if (session) {
    const remoteUrl = `https://vibpage.com/remote?s=${session.sessionId}`;
    const qr = await generateQrCode(remoteUrl);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "system", text: `${qr}\n${texts.orVisit}: ${remoteUrl}` },
    ]);
  }
  return;
}
```

- [ ] **Step 4: Lock input when remote is active**

Modify the TextInput `focus` prop. Find the TextInput component and update:

```typescript
focus={!isLoading && !isRemoteLocked && (!isMenuMode || mode === "command-select")}
```

- [ ] **Step 5: Forward agent events to remote session**

In the `agent.subscribe` useEffect (where events are handled), add forwarding to remote. After each event is processed locally, forward to the remote session if active.

In the `message_update` event handler, after updating streaming text, add:

```typescript
const remoteSession = getActiveSession();
if (remoteSession) {
  remoteSession.send({ type: "message_delta", text: newChunk });
}
```

In the `message_end` event handler, after adding the final message, add:

```typescript
const remoteSession = getActiveSession();
if (remoteSession) {
  remoteSession.send({ type: "message_end", text: finalText });
}
```

In `tool_execution_start`, add:

```typescript
const remoteSession = getActiveSession();
if (remoteSession) {
  remoteSession.send({ type: "tool", name: toolName, status: "running" });
}
```

In `tool_execution_end`, add:

```typescript
const remoteSession = getActiveSession();
if (remoteSession) {
  remoteSession.send({ type: "tool", name: toolName, status: success ? "done" : "error" });
}
```

- [ ] **Step 6: Add Escape to disconnect remote**

In the `useInput` hook, update the `isLoading` handler to also handle remote disconnect:

```typescript
if (isLoading || isRemoteLocked) {
  if (key.escape) {
    if (isRemoteLocked) {
      stopRemoteSession();
      setIsRemoteLocked(false);
    } else {
      exit();
    }
  }
  return;
}
```

- [ ] **Step 7: Add busy state forwarding**

In `sendPrompt`, after setting `isLoading(true)`, add:

```typescript
const remoteSession = getActiveSession();
if (remoteSession) {
  remoteSession.send({ type: "busy" });
}
```

After `setIsLoading(false)` in the finally block, add:

```typescript
const remoteSession = getActiveSession();
if (remoteSession) {
  remoteSession.send({ type: "ready" });
}
```

- [ ] **Step 8: Build to verify**

Run: `npm run build 2>&1`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/ui.tsx
git commit -m "feat: add /remote command with QR code and input locking"
```

---

## Chunk 3: Phone Web Page

### Task 7: Create phone remote control page

**Files:**
- Create: `VibPageSite/src/pages/remote.astro`

- [ ] **Step 1: Create the page**

```astro
---
// VibPageSite/src/pages/remote.astro
// Phone remote control page — connects to CLI via WebSocket
import Layout from "../layouts/Layout.astro";
---

<Layout title="VibPage Remote">
  <div id="app">
    <header id="header">
      <h1>VibPage Remote</h1>
      <span id="status-dot" class="dot disconnected"></span>
      <span id="status-text">Connecting...</span>
    </header>

    <div id="messages"></div>

    <footer id="input-bar">
      <input type="text" id="input" placeholder="Type a command..." maxlength="2000" autocomplete="off" />
      <button id="send-btn" disabled>Send</button>
    </footer>
  </div>

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    #app {
      display: flex;
      flex-direction: column;
      height: 100dvh;
      max-width: 600px;
      margin: 0 auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
    }

    #header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid #222;
      background: #111;
    }

    #header h1 {
      font-size: 16px;
      font-weight: 600;
      flex: 1;
      color: #97DCE2;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.connected { background: #4ade80; }
    .dot.disconnected { background: #f87171; }

    #status-text {
      font-size: 12px;
      color: #888;
    }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .msg.user {
      align-self: flex-end;
      background: #1d4ed8;
      color: white;
      border-bottom-right-radius: 4px;
    }

    .msg.assistant {
      align-self: flex-start;
      background: #1e1e1e;
      color: #e0e0e0;
      border-bottom-left-radius: 4px;
    }

    .msg.system {
      align-self: center;
      background: transparent;
      color: #888;
      font-size: 12px;
      padding: 4px 8px;
    }

    .msg.tool {
      align-self: flex-start;
      background: #1a1a2e;
      color: #97DCE2;
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 8px;
    }

    #input-bar {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid #222;
      background: #111;
    }

    #input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #333;
      border-radius: 20px;
      background: #1e1e1e;
      color: #e0e0e0;
      font-size: 16px;
      outline: none;
    }
    #input:focus { border-color: #97DCE2; }
    #input:disabled { opacity: 0.5; }

    #send-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 20px;
      background: #1d4ed8;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    #send-btn:disabled { opacity: 0.4; cursor: default; }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f87171;
      font-size: 18px;
      z-index: 100;
    }
  </style>

  <script>
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("s");

    const messagesEl = document.getElementById("messages")!;
    const inputEl = document.getElementById("input") as HTMLInputElement;
    const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
    const statusDot = document.getElementById("status-dot")!;
    const statusText = document.getElementById("status-text")!;

    let ws: WebSocket | null = null;
    let busy = false;
    let currentAssistantEl: HTMLDivElement | null = null;
    let currentAssistantText = "";

    function addMessage(role: string, text: string) {
      const div = document.createElement("div");
      div.className = `msg ${role}`;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function setConnected(connected: boolean) {
      statusDot.className = `dot ${connected ? "connected" : "disconnected"}`;
      statusText.textContent = connected ? "Connected" : "Disconnected";
      inputEl.disabled = !connected;
      sendBtn.disabled = !connected || busy;
    }

    function setBusy(b: boolean) {
      busy = b;
      sendBtn.disabled = !ws || busy;
      inputEl.disabled = !ws || busy;
    }

    function showOverlay(text: string) {
      const div = document.createElement("div");
      div.className = "overlay";
      div.textContent = text;
      document.body.appendChild(div);
    }

    function sendPrompt() {
      const text = inputEl.value.trim();
      if (!text || !ws || busy) return;
      ws.send(JSON.stringify({ type: "prompt", text }));
      addMessage("user", text);
      inputEl.value = "";
      setBusy(true);
    }

    if (!sessionId) {
      showOverlay("Missing session ID");
    } else {
      const host = window.location.hostname === "localhost"
        ? "ws://localhost:8787"
        : "wss://vibpage-api.eickegao.workers.dev";
      ws = new WebSocket(`${host}/api/remote/${sessionId}?role=mobile`);

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "message_delta":
              if (!currentAssistantEl) {
                currentAssistantEl = addMessage("assistant", "") as HTMLDivElement;
                currentAssistantText = "";
              }
              currentAssistantText += msg.text || "";
              currentAssistantEl.textContent = currentAssistantText;
              messagesEl.scrollTop = messagesEl.scrollHeight;
              break;

            case "message_end":
              if (currentAssistantEl) {
                currentAssistantEl.textContent = msg.text || currentAssistantText;
              } else {
                addMessage("assistant", msg.text || "");
              }
              currentAssistantEl = null;
              currentAssistantText = "";
              break;

            case "tool":
              const icon = msg.status === "running" ? "◦" : msg.status === "done" ? "✓" : "✗";
              addMessage("tool", `${icon} ${msg.name}`);
              break;

            case "busy":
              setBusy(true);
              break;

            case "ready":
              setBusy(false);
              break;

            case "disconnected":
              if (msg.from === "cli") {
                showOverlay("CLI disconnected");
                ws?.close();
              }
              break;

            case "error":
              addMessage("system", msg.message || "Error");
              break;
          }
        } catch {
          // Ignore malformed
        }
      };

      ws.onclose = (event) => {
        setConnected(false);
        if (event.code === 4001) {
          showOverlay("Session already connected");
        }
      };

      ws.onerror = () => {
        setConnected(false);
        showOverlay("Connection failed");
      };
    }

    sendBtn.addEventListener("click", sendPrompt);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendPrompt();
    });
  </script>
</Layout>
```

- [ ] **Step 2: Build to verify**

Run: `cd VibPageSite && npm run build 2>&1 | tail -10`
Expected: Build succeeds, `remote.astro` is compiled.

- [ ] **Step 3: Commit**

```bash
git add VibPageSite/src/pages/remote.astro
git commit -m "feat: add phone remote control web page"
```

---

## Chunk 4: Deploy and Test

### Task 8: Deploy Worker with Durable Object

- [ ] **Step 1: Deploy Worker**

Run: `cd worker && npx wrangler deploy 2>&1`
Expected: Successful deployment with RemoteSession DO binding.

- [ ] **Step 2: Deploy website**

Run: `cd VibPageSite && npm run build`
Then deploy via Cloudflare Pages (however the project deploys — likely `wrangler pages deploy` or git push).

- [ ] **Step 3: Build CLI**

Run: `npm run build 2>&1`
Expected: No errors.

- [ ] **Step 4: Test end-to-end**

1. Run `npm start` to start CLI.
2. Type `/remote` — should see QR code in terminal + URL.
3. Open the URL on phone (or in a second browser tab for testing).
4. Phone page should show "Connected".
5. Type a message on phone page → should appear in CLI and execute.
6. AI response should stream back to phone page.
7. Press Escape in CLI → phone shows "CLI disconnected".

- [ ] **Step 5: Final commit with version bump**

```bash
# Update version
# Edit package.json version
git add -A
git commit -m "feat: QR code remote control complete"
```
