# QR Code Remote Control Design

## Summary

Allow users to control the VibPage CLI from their phone by scanning a QR code. The CLI displays a QR code in the terminal via the `/remote` command. The phone opens a web page, connects via WebSocket through a Cloudflare Durable Object relay, and sends commands that the CLI executes. Results stream back to the phone.

## Architecture

```
CLI ──WebSocket──► Worker (Durable Object) ◄──WebSocket── Phone Browser
```

- **Worker Durable Object** (`RemoteSession`): Maintains two WebSocket connections (CLI + mobile), relays messages between them.
- **CLI**: New `/remote` command generates a session, displays QR code in terminal, locks input while phone is connected.
- **Phone Web Page**: `vibpage.com/remote?s={sessionId}` — simple chat UI, no login required.

## Components

### 1. Worker: RemoteSession Durable Object

**Route**: `GET /api/remote/:sessionId` — WebSocket upgrade.

Query param `role=cli` or `role=mobile` identifies the connection.

**Behavior**:
- Stores up to 2 WebSocket connections (one CLI, one mobile).
- Only one mobile connection allowed; second attempt rejected with WebSocket close code 4001 "Session already has a mobile connection". Phone page shows "already connected" error.
- Messages from mobile are forwarded to CLI and vice versa.
- On disconnect, notifies the other end.
- Idle timeout: if no connections for 5 minutes, DO self-destructs via `alarm()`.
- Auto-hibernates when both connections close.

**Message Protocol** (JSON):

```typescript
// Mobile → CLI
{ type: "prompt", text: "go to YouTube and search xxx" }

// CLI → Mobile (text is a delta/chunk, not accumulated)
{ type: "message_delta", text: "Opening " }
{ type: "message_delta", text: "YouTube..." }
{ type: "message_end", text: "Opening YouTube..." }  // full text on completion
{ type: "tool", name: "browser_task", status: "running" }
{ type: "tool", name: "browser_task", status: "done" }
{ type: "busy" }  // agent is processing, reject new prompts

// System
{ type: "connected", from: "mobile" }
{ type: "disconnected", from: "mobile" }
{ type: "error", message: "Session not found" }
```

**wrangler.toml additions**:
```toml
[durable_objects]
bindings = [
  { name = "REMOTE_SESSION", class_name = "RemoteSession" }
]

[[migrations]]
tag = "v1"
new_classes = ["RemoteSession"]
```

### 2. CLI: `/remote` Command

**Flow**:
1. Generate UUID as sessionId.
2. Connect WebSocket to `wss://vibpage-api.eickegao.workers.dev/api/remote/{sessionId}?role=cli`.
3. Display QR code in terminal using `qrcode-terminal` library. URL: `https://vibpage.com/remote?s={sessionId}`.
4. Show localized message: "Scan QR code to connect phone remote" (9 languages).
5. Wait for mobile connection.

**On mobile connect**:
- Show "Phone connected" message in terminal.
- Lock terminal input (TextInput focus = false).
- On receiving `{ type: "prompt", text }`: call `agent.prompt(text)`.
- Forward agent events (message_update, tool_execution_start/end) to mobile via WebSocket.

**On mobile disconnect**:
- Show "Phone disconnected" message.
- Restore terminal input.
- Close WebSocket.

**New dependency**: `qrcode-terminal`

### 3. Phone Web Page: `remote.astro`

**URL**: `https://vibpage.com/remote?s={sessionId}`

**No authentication required** — sessionId is the auth token.

**Implementation**: Static Astro page with inline `<script>` and vanilla JS. No framework needed — the UI is simple enough (append messages to a list, manage one WebSocket).

**UI**:
- Mobile-first full-screen layout.
- Top: title bar with connection status indicator (green dot = connected, red = disconnected).
- Middle: scrollable message list (user messages right-aligned, AI messages left-aligned, tool status as system messages).
- Bottom: text input + send button, fixed above keyboard. Send button disabled while agent is busy.

**Behavior**:
- Extract `s` param from URL.
- Connect WebSocket to `wss://vibpage-api.eickegao.workers.dev/api/remote/{s}?role=mobile`.
- Send `{ type: "prompt", text }` on submit.
- Display incoming messages by type.
- Show "Disconnected" overlay if WebSocket closes.

## Edge Cases

- **Concurrent prompts**: If agent is busy, mobile receives `{ type: "busy" }` and the phone UI disables the send button until the current task completes.
- **Escape key during remote**: Pressing Escape in CLI disconnects the remote session and restores terminal input (does not exit the app).
- **Multiple `/remote` invocations**: If a remote session is already active, show "Remote session already active" message and ignore.
- **QR code fallback**: Also print the URL as plain text below the QR code, in case the terminal is too narrow.
- **WebSocket disconnect/crash**: CLI shows "Connection lost" and restores terminal input. No auto-reconnect — user can run `/remote` again.
- **Prompt length limit**: Mobile input capped at 2000 characters.

## Security

- sessionId is a random UUIDv4 (122 bits of entropy), one-time use, only valid while CLI is running.
- No persistent auth or stored credentials on the phone.
- Only one mobile connection per session.
- Session destroyed when CLI disconnects.
- Origin check on mobile WebSocket upgrade (only allow `vibpage.com`).

## Data Flow Example

1. User runs `/remote` in CLI.
2. CLI generates `sessionId=abc123`, connects WebSocket, shows QR code for `vibpage.com/remote?s=abc123`.
3. User scans QR code with phone.
4. Phone opens page, connects WebSocket with `role=mobile`.
5. DO sends `{ type: "connected", from: "mobile" }` to CLI.
6. CLI locks terminal input, shows "Phone connected".
7. User types "go to YouTube and search xxx" on phone, sends `{ type: "prompt", text: "..." }`.
8. DO forwards to CLI. CLI calls `agent.prompt(text)`.
9. Agent executes, emits events. CLI forwards `{ type: "message", ... }` and `{ type: "tool", ... }` to DO → phone.
10. Phone displays results in chat UI.
11. User closes phone browser. DO sends `{ type: "disconnected", from: "mobile" }` to CLI.
12. CLI restores terminal input.

## Files to Create/Modify

- **Create**: `worker/src/remote-session.ts` — Durable Object class
- **Modify**: `worker/src/index.ts` — Add WebSocket upgrade route, export DO
- **Modify**: `worker/wrangler.toml` — Add DO binding and migration
- **Create**: `src/remote.ts` — CLI WebSocket client + QR code logic
- **Modify**: `src/ui.tsx` — Add `/remote` command, input locking, event forwarding
- **Create**: `VibPageSite/src/pages/remote.astro` — Phone chat page
