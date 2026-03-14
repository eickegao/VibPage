import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const VIEWPORT = { width: 1280, height: 800 };
const MAX_TURNS = 50;

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

interface BrowserApiConfig {
  apiKey: string;
  endpoint: string; // Full URL for Computer Use API
}

function getBrowserApiConfig(): BrowserApiConfig {
  const configPath = join(homedir(), ".vibpage", "config.json");
  let config: any = {};
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  }

  // Proxy mode: route through VibPage worker
  if (config.proxyUrl && config.vibpageApiKey) {
    return {
      apiKey: config.vibpageApiKey,
      endpoint: `${config.proxyUrl}/proxy/openai/v1/responses`,
    };
  }

  // Direct mode
  const apiKey = process.env.OPENAI_API_KEY || config.apiKey || "";
  return {
    apiKey,
    endpoint: "https://api.openai.com/v1/responses",
  };
}

async function callComputerUse(
  config: BrowserApiConfig,
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

  const res = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
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
        await page.mouse.move(action.x!, action.y!);
        await page.mouse.down();
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
        break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function takeScreenshot(page: any): Promise<string> {
  const buffer = await page.screenshot({ type: "png" });
  return buffer.toString("base64");
}

const browserTaskParams = Type.Object({
  url: Type.String({
    description: "Target URL to open in the browser",
  }),
  task: Type.String({
    description: "Natural language description of what to do on this page",
  }),
});

export const browserTaskTool: AgentTool<typeof browserTaskParams> = {
  name: "browser_task",
  label: "Browser Task",
  description:
    "Execute any task in a browser using AI vision and automation. Opens a visible browser, navigates to the URL, and uses AI to understand the page and perform actions (click, type, scroll, etc.) to complete the task. The browser preserves login sessions across runs. Examples: fill forms, post to social media, download reports, interact with any website.",
  parameters: browserTaskParams,
  execute: async (_toolCallId, params) => {
    const apiConfig = getBrowserApiConfig();
    if (!apiConfig.apiKey) {
      throw new Error(
        "API key required for browser tasks. Set OPENAI_API_KEY, or configure proxyUrl + vibpageApiKey in ~/.vibpage/config.json"
      );
    }

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
      await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000));

      const taskPrompt = `You are controlling a browser to complete a task.

URL: ${params.url}
Task: ${params.task}

Instructions:
1. First take a screenshot to see the current state of the page
2. If the site requires login and you're not logged in, tell me and KEEP taking screenshots to wait for the user to log in manually. Do NOT stop.
3. Once ready, perform the necessary actions (click, type, scroll, etc.) to complete the task
4. Take a final screenshot to confirm the task is done
5. Report what you accomplished

IMPORTANT: Do NOT stop early. Keep going until the task is fully completed. If waiting for user action, keep monitoring with screenshots.

Start by taking a screenshot to see the current page state.`;

      let response = await callComputerUse(apiConfig, taskPrompt);
      let turns = 0;
      logs.push(`Started: ${params.task}`);
      logs.push(`URL: ${params.url}`);

      while (turns < MAX_TURNS) {
        turns++;

        const computerCall = response.output?.find(
          (o: any) => o.type === "computer_call"
        ) as ComputerCallOutput | undefined;

        if (!computerCall) {
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

          const lowerText = aiText.toLowerCase();
          const isDone = lowerText.includes("completed") ||
            lowerText.includes("successfully") ||
            lowerText.includes("complete") ||
            lowerText.includes("done") ||
            lowerText.includes("finished") ||
            lowerText.includes("posted") ||
            lowerText.includes("published") ||
            lowerText.includes("submitted");

          if (isDone) {
            logs.push("Task completed.");
            break;
          }

          logs.push("Continuing...");
          await new Promise((r) => setTimeout(r, 3000));
          const screenshot = await takeScreenshot(page);
          response = await callComputerUse(
            apiConfig,
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

        const actionDescs = computerCall.actions.map((a) => {
          if (a.type === "click") return `click(${a.x},${a.y})`;
          if (a.type === "type") return `type("${a.text?.slice(0, 30)}...")`;
          if (a.type === "keypress") return `keypress(${a.keys?.join("+")})`;
          if (a.type === "scroll") return `scroll(${a.scrollX},${a.scrollY})`;
          return a.type;
        });
        logs.push(`Turn ${turns}: ${actionDescs.join(", ")}`);

        await executeActions(page, computerCall.actions);
        await new Promise((r) => setTimeout(r, 1500));

        const screenshot = await takeScreenshot(page);
        response = await callComputerUse(
          apiConfig,
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
        content: [{ type: "text", text: logs.join("\n") }],
        details: {},
      };
    } catch (err) {
      logs.push(`Error: ${(err as Error).message}`);
      return {
        content: [{ type: "text", text: logs.join("\n") }],
        details: {},
      };
    }
  },
};
