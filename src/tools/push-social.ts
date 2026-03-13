import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const VIEWPORT = { width: 1280, height: 800 };
const MAX_TURNS = 30;

// Track open browser so it can be closed via closeBrowser()
let openContext: any = null;

export async function closeBrowser(): Promise<boolean> {
  if (openContext) {
    await openContext.close();
    openContext = null;
    return true;
  }
  return false;
}

export async function openBrowser(url?: string): Promise<boolean> {
  const userDataDir = join(homedir(), ".vibpage", "browser-data");

  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    return false;
  }

  if (openContext) {
    // Already open — just navigate to url if provided
    if (url) {
      const page = openContext.pages()[0] || (await openContext.newPage());
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    return true;
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: VIEWPORT,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  openContext = context;

  if (url) {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  return true;
}

interface ComputerAction {
  type: string;
  x?: number;
  y?: number;
  button?: string;
  text?: string;
  keys?: string[];
  scrollX?: number;
  scrollY?: number;
}

interface ComputerCallOutput {
  type: "computer_call";
  call_id: string;
  actions: ComputerAction[];
  status: string;
}

function getOpenAIKey(): string {
  // Try env var first
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  // Try config file
  const configPath = join(homedir(), ".vibpage", "config.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.provider === "openai" && config.apiKey) return config.apiKey;
    if (config.apiKey && !config.provider) return config.apiKey;
  }
  return "";
}

async function callComputerUse(
  apiKey: string,
  input: string | any[],
  previousResponseId?: string
): Promise<{ id: string; output: any[] }> {
  const body: any = {
    model: "gpt-5.4",
    tools: [{ type: "computer" }],
    input,
  };
  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function executeActions(page: any, actions: ComputerAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "click":
        await page.mouse.click(action.x!, action.y!, {
          button: action.button || "left",
        });
        break;
      case "double_click":
        await page.mouse.dblclick(action.x!, action.y!, {
          button: action.button || "left",
        });
        break;
      case "type":
        await page.keyboard.type(action.text!, { delay: 30 });
        break;
      case "keypress":
        for (const key of action.keys || []) {
          await page.keyboard.press(key);
        }
        break;
      case "scroll":
        await page.mouse.move(action.x!, action.y!);
        await page.mouse.wheel(action.scrollX || 0, action.scrollY || 0);
        break;
      case "drag":
        // start at x,y, drag to target
        await page.mouse.move(action.x!, action.y!);
        await page.mouse.down();
        // If drag has target coords, use them
        const dragAction = action as any;
        if (dragAction.toX !== undefined && dragAction.toY !== undefined) {
          await page.mouse.move(dragAction.toX, dragAction.toY);
        }
        await page.mouse.up();
        break;
      case "move":
        await page.mouse.move(action.x!, action.y!);
        break;
      case "wait":
        await new Promise((r) => setTimeout(r, 2000));
        break;
      case "screenshot":
        // No-op, we always take screenshot after actions
        break;
    }
    // Small delay between actions
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function takeScreenshot(page: any): Promise<string> {
  const buffer = await page.screenshot({ type: "png" });
  return buffer.toString("base64");
}

const PLATFORM_URLS: Record<string, string> = {
  x: "https://x.com",
  twitter: "https://x.com",
  linkedin: "https://www.linkedin.com",
};

const pushSocialParams = Type.Object({
  platform: Type.String({
    description: "Social platform to post to (e.g. 'x')",
  }),
  content: Type.String({
    description: "The content/text to post",
  }),
});

export const pushSocialTool: AgentTool<typeof pushSocialParams> = {
  name: "push_social",
  label: "Push to Social",
  description:
    "Post content to social media platforms using browser automation. Supports: X (Twitter), LinkedIn. The browser will open visibly so you can monitor the process.",
  parameters: pushSocialParams,
  execute: async (_toolCallId, params) => {
    const apiKey = getOpenAIKey();
    if (!apiKey) {
      throw new Error(
        "OpenAI API key required for social media push. Set OPENAI_API_KEY or configure in ~/.vibpage/config.json with provider: openai"
      );
    }

    const platformKey = params.platform.toLowerCase();
    const url = PLATFORM_URLS[platformKey];
    if (!url) {
      throw new Error(
        `Unsupported platform: ${params.platform}. Supported: ${Object.keys(PLATFORM_URLS).join(", ")}`
      );
    }

    // Use persistent browser context to preserve login sessions
    const userDataDir = join(homedir(), ".vibpage", "browser-data");

    let chromium;
    try {
      const pw = await import("playwright");
      chromium = pw.chromium;
    } catch {
      throw new Error(
        "Playwright not available. Run: npx playwright install chromium"
      );
    }

    // Close any previously open browser
    if (openContext) {
      await openContext.close();
      openContext = null;
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: VIEWPORT,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    openContext = context;
    const logs: string[] = [];

    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Wait for page to settle
      await new Promise((r) => setTimeout(r, 3000));

      const taskPrompt = `You are controlling a browser to post content on ${params.platform}.

The content to post is:
"""
${params.content}
"""

Steps:
1. First take a screenshot to see the current state
2. If not logged in, tell me and KEEP taking screenshots every few seconds to wait for the user to log in manually. Do NOT stop — keep checking until you see the logged-in home feed.
3. Once logged in, find the compose/new post area
4. Type the content
5. Click the post/publish button
6. Take a final screenshot to confirm the post was published

IMPORTANT: Do NOT stop early. Always keep going until the post is confirmed published. If waiting for login, keep taking screenshots to monitor.

Start by taking a screenshot to see the current page state.`;

      // Initial call
      let response = await callComputerUse(apiKey, taskPrompt);
      let turns = 0;
      logs.push(`Started push to ${params.platform}`);

      while (turns < MAX_TURNS) {
        turns++;

        // Find computer_call in output
        const computerCall = response.output?.find(
          (o: any) => o.type === "computer_call"
        ) as ComputerCallOutput | undefined;

        // Check if model produced text (completion message)
        const textOutput = response.output?.find(
          (o: any) => o.type === "message" || (o.type === "text" && o.text)
        );

        if (!computerCall) {
          // Extract any text the model returned
          let aiText = "";
          for (const o of response.output || []) {
            if (o.type === "text" && (o as any).text) {
              aiText = (o as any).text;
            } else if (o.type === "message" && (o as any).content) {
              for (const c of (o as any).content) {
                if (c.type === "text") aiText = c.text;
              }
            }
          }
          if (aiText) logs.push(`AI: ${aiText}`);

          // Check if it seems like a completion or just a status update
          const lowerText = aiText.toLowerCase();
          const isDone = lowerText.includes("posted") ||
            lowerText.includes("published") ||
            lowerText.includes("successfully") ||
            lowerText.includes("complete") ||
            lowerText.includes("done");

          if (isDone) {
            logs.push("Post completed successfully.");
            break;
          }

          // Not done yet — send a follow-up to keep the loop going
          logs.push("Continuing...");
          await new Promise((r) => setTimeout(r, 3000));
          const screenshot = await takeScreenshot(page);
          response = await callComputerUse(
            apiKey,
            [
              {
                type: "computer_call_output",
                call_id: "continue",
                output: {
                  type: "computer_screenshot",
                  image_url: `data:image/png;base64,${screenshot}`,
                  detail: "original",
                },
              },
            ],
            response.id
          );
          continue;
        }

        // Execute the actions
        const actionDescs = computerCall.actions.map((a) => {
          if (a.type === "click") return `click(${a.x},${a.y})`;
          if (a.type === "type") return `type("${a.text?.slice(0, 30)}...")`;
          if (a.type === "keypress") return `keypress(${a.keys?.join("+")})`;
          if (a.type === "scroll") return `scroll(${a.scrollX},${a.scrollY})`;
          return a.type;
        });
        logs.push(`Turn ${turns}: ${actionDescs.join(", ")}`);

        await executeActions(page, computerCall.actions);

        // Wait for page to update after actions
        await new Promise((r) => setTimeout(r, 1500));

        // Take screenshot and send back
        const screenshot = await takeScreenshot(page);

        response = await callComputerUse(
          apiKey,
          [
            {
              type: "computer_call_output",
              call_id: computerCall.call_id,
              output: {
                type: "computer_screenshot",
                image_url: `data:image/png;base64,${screenshot}`,
                detail: "original",
              },
            },
          ],
          response.id
        );
      }

      if (turns >= MAX_TURNS) {
        logs.push("Reached maximum turns limit.");
      }

      return {
        content: [
          {
            type: "text",
            text: logs.join("\n"),
          },
        ],
        details: {},
      };
    } catch (err) {
      logs.push(`Error: ${(err as Error).message}`);
      return {
        content: [{ type: "text", text: logs.join("\n") }],
        details: {},
      };
    }
    // Browser stays open — user can close it manually or via /close-browser
  },
};
