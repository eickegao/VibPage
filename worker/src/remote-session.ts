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
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
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

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
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
        this.closeMobile();
      } else {
        this.mobileSocket = null;
        this.send(this.cliSocket, { type: "disconnected", from: "mobile" });
      }
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
