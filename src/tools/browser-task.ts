import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { extractDom, formatDomSnapshot, type DomElement } from "./dom-extractor.js";
import { planDomActions, type DomAction } from "./dom-planner.js";
import { executeDomActions, formatResults, executeResolvedActions } from "./dom-executor.js";
import {
  findRecording,
  startRecordingSession,
  addTentativeAction,
  markVisionUsed,
  hasTentativeActions,
  commitRecordings,
  discardRecordings,
  deleteRecording,
  updateRecordingUsage,
  getUrlPattern,
} from "./recording.js";

type Precision = "high" | "normal";
type Mode = "hybrid" | "vision";

const VIEWPORT_HIGH = { width: 1280, height: 800 };
const VIEWPORT_NORMAL = { width: 1024, height: 768 };
const MAX_TURNS = 50;

// Track open browser so it can be closed via closeBrowser()
let openContext: any = null;

export function isBrowserOpen(): boolean {
  return openContext !== null;
}

export function hasPendingRecording(): boolean {
  return hasTentativeActions();
}

export function confirmRecording(): number {
  return commitRecordings();
}

export function rejectRecording(): void {
  discardRecordings();
}

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
    viewport: VIEWPORT_NORMAL,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  openContext = context;

  if (url) {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  return true;
}

// ========== Computer Use (Vision mode) ==========

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
  endpoint: string;
}

function getBrowserApiConfig(): BrowserApiConfig {
  const configPath = join(homedir(), ".vibpage", "config.json");
  let config: any = {};
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  }

  if (config.proxyUrl && config.vibpageApiKey) {
    return {
      apiKey: config.vibpageApiKey,
      endpoint: `${config.proxyUrl}/proxy/openai/v1/responses`,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY || config.apiKey || "";
  return { apiKey, endpoint: "https://api.openai.com/v1/responses" };
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

async function executeVisionActions(page: any, actions: ComputerAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "click":
        await page.mouse.click(action.x!, action.y!, { button: action.button || "left" });
        break;
      case "double_click":
        await page.mouse.dblclick(action.x!, action.y!, { button: action.button || "left" });
        break;
      case "type":
        await page.keyboard.type(action.text!, { delay: 30 });
        break;
      case "keypress":
        for (const key of action.keys || []) await page.keyboard.press(key);
        break;
      case "scroll":
        await page.mouse.move(action.x!, action.y!);
        await page.mouse.wheel(action.scrollX || 0, action.scrollY || 0);
        break;
      case "drag":
        await page.mouse.move(action.x!, action.y!);
        await page.mouse.down();
        const da = action as any;
        if (da.toX !== undefined && da.toY !== undefined) await page.mouse.move(da.toX, da.toY);
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

async function takeScreenshot(page: any, precision: Precision): Promise<string> {
  if (precision === "high") {
    const buffer = await page.screenshot({ type: "png" });
    return buffer.toString("base64");
  }
  const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
  return buffer.toString("base64");
}

function screenshotMimeType(precision: Precision): string {
  return precision === "high" ? "image/png" : "image/jpeg";
}

function screenshotDetail(precision: Precision): string {
  return precision === "high" ? "high" : "auto";
}

// ========== Vision-only execution loop ==========

async function runVisionMode(
  page: any,
  apiConfig: BrowserApiConfig,
  task: string,
  url: string,
  precision: Precision,
  logs: string[]
): Promise<void> {
  const taskPrompt = `You are controlling a browser to complete a task.

URL: ${url}
Task: ${task}

Instructions:
1. First take a screenshot to see the current state of the page
2. If the site requires login and you're not logged in, tell me and KEEP taking screenshots to wait for the user to log in manually. Do NOT stop.
3. Once ready, perform the necessary actions (click, type, scroll, etc.) to complete the task
4. Take a final screenshot to confirm the task is done
5. Report what you accomplished

IMPORTANT: Do NOT stop early. Keep going until the task is fully completed.

Start by taking a screenshot to see the current page state.`;

  let response = await callComputerUse(apiConfig, taskPrompt);
  let turns = 0;

  while (turns < MAX_TURNS) {
    turns++;

    const computerCall = response.output?.find(
      (o: any) => o.type === "computer_call"
    ) as ComputerCallOutput | undefined;

    if (!computerCall) {
      let aiText = "";
      for (const o of response.output || []) {
        if (o.type === "text" && (o as any).text) aiText = (o as any).text;
        else if (o.type === "message" && (o as any).content) {
          for (const c of (o as any).content) {
            if (c.type === "text") aiText = c.text;
          }
        }
      }
      if (aiText) logs.push(`AI: ${aiText}`);

      const lower = aiText.toLowerCase();
      const isDone = ["completed", "successfully", "complete", "done", "finished", "posted", "published", "submitted"]
        .some(w => lower.includes(w));

      if (isDone) {
        logs.push("Task completed.");
        break;
      }

      logs.push("Continuing...");
      await new Promise((r) => setTimeout(r, 3000));
      const screenshot = await takeScreenshot(page, precision);
      response = await callComputerUse(
        apiConfig,
        [{
          type: "computer_call_output",
          call_id: "continue",
          output: {
            type: "computer_screenshot",
            image_url: `data:${screenshotMimeType(precision)};base64,${screenshot}`,
            detail: screenshotDetail(precision),
          },
        }],
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
    logs.push(`[vision] Turn ${turns}: ${actionDescs.join(", ")}`);

    await executeVisionActions(page, computerCall.actions);
    await new Promise((r) => setTimeout(r, precision === "high" ? 1500 : 800));

    const screenshot = await takeScreenshot(page, precision);
    response = await callComputerUse(
      apiConfig,
      [{
        type: "computer_call_output",
        call_id: computerCall.call_id,
        output: {
          type: "computer_screenshot",
          image_url: `data:${screenshotMimeType(precision)};base64,${screenshot}`,
          detail: screenshotDetail(precision),
        },
      }],
      response.id
    );
  }

  if (turns >= MAX_TURNS) {
    logs.push("Reached maximum turns limit.");
  }
}

// ========== Single-step vision fallback ==========

function describeActionForVision(action: DomAction, elements: DomElement[]): string {
  const el = action.element ? elements.find(e => e.index === action.element) : null;
  const elDesc = el ? `the ${el.tag} element "${el.text}"` : "";

  switch (action.action) {
    case "click":
      return `Click on ${elDesc}`;
    case "fill":
      return `Type "${action.value}" into ${elDesc}`;
    case "select":
      return `Select "${action.value}" from ${elDesc}`;
    case "keypress":
      return `Press ${(action.keys || []).join("+")} on the keyboard`;
    case "scroll":
      return `Scroll ${action.direction || "down"} on the page`;
    case "goto":
      return `Navigate to ${action.url}`;
    case "wait":
      return "Wait for the page to load";
    default:
      return `Perform action: ${action.action}`;
  }
}

const SINGLE_STEP_MAX_TURNS = 10;

async function runSingleVisionStep(
  page: any,
  apiConfig: BrowserApiConfig,
  actionDescription: string,
  precision: Precision,
  logs: string[]
): Promise<boolean> {
  const prompt = `You are controlling a browser. Perform ONLY this one action:

${actionDescription}

Take a screenshot first to see the current page, then do exactly this one action. Once this single action is done, say "Action completed." and stop. Do NOT do anything beyond this one action.`;

  let response = await callComputerUse(apiConfig, prompt);
  let turns = 0;

  while (turns < SINGLE_STEP_MAX_TURNS) {
    turns++;

    const computerCall = response.output?.find(
      (o: any) => o.type === "computer_call"
    ) as ComputerCallOutput | undefined;

    if (!computerCall) {
      // Vision finished this step
      logs.push(`[vision-step] Completed: ${actionDescription}`);
      return true;
    }

    const actionDescs = computerCall.actions.map((a) => {
      if (a.type === "click") return `click(${a.x},${a.y})`;
      if (a.type === "type") return `type("${a.text?.slice(0, 30)}...")`;
      if (a.type === "keypress") return `keypress(${a.keys?.join("+")})`;
      if (a.type === "scroll") return `scroll(${a.scrollX},${a.scrollY})`;
      return a.type;
    });
    logs.push(`[vision-step] ${actionDescs.join(", ")}`);

    await executeVisionActions(page, computerCall.actions);
    await new Promise((r) => setTimeout(r, precision === "high" ? 1500 : 800));

    const screenshot = await takeScreenshot(page, precision);
    response = await callComputerUse(
      apiConfig,
      [{
        type: "computer_call_output",
        call_id: computerCall.call_id,
        output: {
          type: "computer_screenshot",
          image_url: `data:${screenshotMimeType(precision)};base64,${screenshot}`,
          detail: screenshotDetail(precision),
        },
      }],
      response.id
    );
  }

  logs.push(`[vision-step] Max turns reached for: ${actionDescription}`);
  return false;
}

// ========== Hybrid execution loop ==========

async function runHybridMode(
  page: any,
  apiConfig: BrowserApiConfig,
  task: string,
  url: string,
  precision: Precision,
  logs: string[]
): Promise<void> {
  // Check recording cache before starting AI planning
  const urlPattern = getUrlPattern(url);
  const cached = findRecording(urlPattern, task);
  if (cached) {
    logs.push(`[cached] Replaying ${cached.actions.length} recorded steps...`);
    const results = await executeResolvedActions(page, cached.actions);
    const allSuccess = results.every(r => r.success);
    if (allSuccess) {
      updateRecordingUsage(cached.id);
      logs.push(`[cached] All ${cached.actions.length} steps replayed successfully`);
      return;
    }
    logs.push(`[cached] Replay failed, falling back to AI mode`);
    deleteRecording(cached.id);
  }

  // Start tentative recording session for this task
  startRecordingSession(url, task);

  let turns = 0;
  let previousActionLog: string[] = [];

  while (turns < MAX_TURNS) {
    turns++;

    // Step 1: Extract DOM snapshot
    let snapshot;
    try {
      snapshot = await extractDom(page);
    } catch {
      logs.push(`[hybrid] Turn ${turns}: DOM extraction failed, falling back to full vision mode`);
      await runVisionMode(page, apiConfig, task, url, precision, logs);
      return;
    }

    const domText = formatDomSnapshot(snapshot);

    // Check if page has enough interactive elements for DOM mode
    if (snapshot.elements.length === 0) {
      logs.push(`[hybrid] Turn ${turns}: No interactive elements found, falling back to full vision mode`);
      await runVisionMode(page, apiConfig, task, url, precision, logs);
      return;
    }

    // Step 2: Ask cheap LLM to plan actions
    let plan;
    try {
      plan = await planDomActions(
        task,
        domText,
        previousActionLog.length > 0 ? previousActionLog.join("\n") : undefined
      );
    } catch (err) {
      logs.push(`[hybrid] Turn ${turns}: Planner failed (${(err as Error).message}), falling back to full vision mode`);
      await runVisionMode(page, apiConfig, task, url, precision, logs);
      return;
    }

    logs.push(`[hybrid] Turn ${turns}: ${plan.reasoning}`);

    // Separate done from executable actions
    const doneAction = plan.actions.find((a: DomAction) => a.action === "done");
    const executableActions = plan.actions.filter(
      (a: DomAction) => a.action !== "done" && a.action !== "use_vision"
    );

    // If only "done" with no real actions, task is complete
    if (doneAction && executableActions.length === 0) {
      logs.push(`[hybrid] Task completed: ${doneAction.message || "done"}`);
      return;
    }

    // Step 3: Execute actions one by one — DOM first, vision fallback per action
    let turnLog: string[] = [];
    for (const action of executableActions) {
      const result = await executeDomActions(page, [action], snapshot.elements);
      const r = result[0];

      if (r.success) {
        const desc = `${r.action.action}${r.action.element ? ` [${r.action.element}]` : ""}${r.action.value ? ` "${r.action.value}"` : ""}`;
        turnLog.push(`✓ DOM: ${desc}`);
        addTentativeAction(action, snapshot.elements);
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        // DOM failed — try this specific action via vision
        markVisionUsed();
        const actionDesc = describeActionForVision(action, snapshot.elements);
        logs.push(`[hybrid] DOM failed for "${actionDesc}", trying vision...`);
        const visionOk = await runSingleVisionStep(page, apiConfig, actionDesc, precision, logs);
        if (visionOk) {
          turnLog.push(`✓ Vision: ${actionDesc}`);
        } else {
          turnLog.push(`✗ Vision failed: ${actionDesc}`);
          logs.push(`[hybrid] Both DOM and vision failed for: ${actionDesc}`);
        }
        // After vision step, DOM snapshot is stale — break and re-plan
        break;
      }
    }

    const resultText = turnLog.join("\n");
    logs.push(resultText);
    previousActionLog.push(`Turn ${turns}: ${resultText}`);

    // Wait for page to settle
    await new Promise((r) => setTimeout(r, 1000));

    // If planner included "done", task is complete after executing actions
    if (doneAction) {
      logs.push(`[hybrid] Task completed: ${doneAction.message || "done"}`);
      return;
    }
  }

  if (turns >= MAX_TURNS) {
    logs.push("Reached maximum turns limit.");
  }
}

// ========== Tool definition ==========

const browserTaskParams = Type.Object({
  url: Type.String({
    description: "Target URL to open in the browser",
  }),
  task: Type.String({
    description: "Natural language description of what to do on this page",
  }),
  mode: Type.Optional(
    Type.Union([Type.Literal("hybrid"), Type.Literal("vision")], {
      description:
        'Execution mode. "hybrid" (default) = uses DOM analysis with cheap LLM first, falls back to Computer Use vision only when needed. Saves ~80% tokens. "vision" = pure Computer Use with screenshots every turn (original mode, more reliable for complex visual tasks).',
    })
  ),
  precision: Type.Optional(
    Type.Union([Type.Literal("high"), Type.Literal("normal")], {
      description:
        'Precision for vision mode screenshots. "high" = full PNG. "normal" (default) = compressed JPEG. Only applies to vision mode.',
    })
  ),
});

export const browserTaskTool: AgentTool<typeof browserTaskParams> = {
  name: "browser_task",
  label: "Browser Task",
  description:
    "Execute any task in a browser using AI automation. Two modes: 'hybrid' (default, cheaper) analyzes the page DOM first and uses Playwright for actions, falling back to AI vision only when needed. 'vision' mode uses Computer Use with screenshots for every action (more reliable for complex visual tasks). The browser preserves login sessions across runs.",
  parameters: browserTaskParams,
  execute: async (_toolCallId, params) => {
    const apiConfig = getBrowserApiConfig();
    if (!apiConfig.apiKey) {
      throw new Error(
        "API key required for browser tasks. Set OPENAI_API_KEY, or configure proxyUrl + vibpageApiKey in ~/.vibpage/config.json"
      );
    }

    const mode: Mode = params.mode || "hybrid";
    const precision: Precision = params.precision || "normal";
    const viewport = precision === "high" ? VIEWPORT_HIGH : VIEWPORT_NORMAL;

    const userDataDir = join(homedir(), ".vibpage", "browser-data");

    let chromium;
    try {
      const pw = await import("playwright");
      chromium = pw.chromium;
    } catch {
      throw new Error("Playwright not available. Run: npx playwright install chromium");
    }

    if (openContext) {
      await openContext.close();
      openContext = null;
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    openContext = context;
    const logs: string[] = [];

    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000));

      logs.push(`Started: ${params.task} [mode: ${mode}, precision: ${precision}]`);
      logs.push(`URL: ${params.url}`);

      if (mode === "vision") {
        await runVisionMode(page, apiConfig, params.task, params.url, precision, logs);
      } else {
        await runHybridMode(page, apiConfig, params.task, params.url, precision, logs);
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
