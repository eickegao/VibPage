import http from "http";
import { exec } from "child_process";
import { loadConfig, saveConfig } from "./config.js";

const LOGIN_URL = "https://vibpage.com/login";
const API_URL = "https://vibpage-api.eickegao.workers.dev";

function openBrowser(url: string): void {
  const cmd = process.platform === "win32"
    ? `start "" "${url}"`
    : process.platform === "darwin"
    ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd);
}

export async function login(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost`);

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");

        if (!token) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Login failed</h1><p>No token received. Please try again.</p>");
          server.close();
          reject(new Error("No token received"));
          return;
        }

        // Exchange Clerk JWT for VibPage API key
        try {
          const apiRes = await fetch(`${API_URL}/api/auth/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          });

          if (!apiRes.ok) {
            throw new Error(`API error: ${apiRes.status}`);
          }

          const data = (await apiRes.json()) as {
            api_key: string;
            email: string;
            plan: string;
            balance: number;
          };

          // Save to config
          const config = loadConfig();
          config.vibpageApiKey = data.api_key;
          config.proxyUrl = API_URL;
          saveConfig(config);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center">
                  <h1 style="color:#2dd4bf">Login Successful!</h1>
                  <p>Logged in as <strong>${data.email || "user"}</strong></p>
                  <p style="color:#888">You can close this window and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          console.log(`\nLogged in as ${data.email || "user"} (plan: ${data.plan})`);
          console.log(`API key saved to ~/.vibpage/config.json\n`);

          server.close();
          resolve();
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end("<h1>Login failed</h1><p>Could not verify token. Please try again.</p>");
          server.close();
          reject(err);
        }
      }
    });

    // Listen on random available port
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const callbackUrl = `http://localhost:${port}/callback`;
      const loginUrl = `${LOGIN_URL}?redirect_uri=${encodeURIComponent(callbackUrl)}`;

      console.log("\nOpening browser for authentication...");
      console.log(`If it doesn't open, visit: ${loginUrl}\n`);

      openBrowser(loginUrl);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out after 5 minutes"));
    }, 5 * 60 * 1000);
  });
}
