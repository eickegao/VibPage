// AI planner that uses a cheap LLM to analyze DOM and produce action plans
// Falls back to Computer Use when DOM approach isn't sufficient

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface DomAction {
  action: "click" | "fill" | "select" | "keypress" | "scroll" | "wait" | "goto" | "use_vision" | "done";
  element?: number;      // Element index from DOM snapshot
  value?: string;        // Value for fill/select
  keys?: string[];       // Keys for keypress
  direction?: string;    // Scroll direction: "up" | "down"
  url?: string;          // URL for goto
  message?: string;      // Status message
}

export interface PlanResult {
  actions: DomAction[];
  reasoning: string;
}

function getApiConfig(): { apiKey: string; endpoint: string } {
  const configPath = join(homedir(), ".vibpage", "config.json");
  let config: any = {};
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  }

  if (config.proxyUrl && config.vibpageApiKey) {
    return {
      apiKey: config.vibpageApiKey,
      endpoint: `${config.proxyUrl}/proxy/openai/v1/chat/completions`,
    };
  }

  return {
    apiKey: process.env.OPENAI_API_KEY || config.apiKey || "",
    endpoint: "https://api.openai.com/v1/chat/completions",
  };
}

const PLANNER_SYSTEM_PROMPT = `You are a browser automation planner. Given a task description and a snapshot of the page's interactive elements, produce a JSON array of actions to complete the task.

Available actions:
- {"action": "click", "element": N} — Click element by index number
- {"action": "fill", "element": N, "value": "text"} — Clear and type into an input/textarea
- {"action": "select", "element": N, "value": "option"} — Select dropdown option
- {"action": "keypress", "keys": ["Enter"]} — Press keyboard keys
- {"action": "scroll", "direction": "down"} — Scroll the page
- {"action": "wait"} — Wait for page to load
- {"action": "goto", "url": "https://..."} — Navigate to URL
- {"action": "done", "message": "description of what was accomplished"} — Task is complete
- {"action": "use_vision"} — Switch to Computer Use vision mode (use ONLY when the page is too complex for DOM actions, e.g. canvas, captcha, visual layout decisions)

Rules:
1. Return ONLY a JSON object with "reasoning" (1 sentence) and "actions" (array)
2. Reference elements by their [N] index number from the snapshot
3. Plan multiple steps at once when the sequence is clear
4. Use "use_vision" if elements are insufficient to complete the task
5. Use "done" when the task is complete
6. Do NOT include explanations outside the JSON`;

export async function planDomActions(
  task: string,
  domSnapshot: string,
  previousActions?: string
): Promise<PlanResult> {
  const config = getApiConfig();

  let userMessage = `Task: ${task}\n\n${domSnapshot}`;
  if (previousActions) {
    userMessage += `\n\nPrevious actions taken:\n${previousActions}`;
  }

  const res = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Planner API error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  const content = data.choices?.[0]?.message?.content || "{}";

  try {
    const parsed = JSON.parse(content);
    return {
      reasoning: parsed.reasoning || "",
      actions: parsed.actions || [],
    };
  } catch {
    return { reasoning: "Failed to parse plan", actions: [{ action: "use_vision" }] };
  }
}
