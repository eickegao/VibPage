// Execute DOM actions returned by the planner using Playwright API

import type { DomAction } from "./dom-planner.js";
import type { DomElement } from "./dom-extractor.js";

export interface ExecutionResult {
  success: boolean;
  action: DomAction;
  error?: string;
}

export async function executeDomActions(
  page: any,
  actions: DomAction[],
  elements: DomElement[]
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  for (const action of actions) {
    if (action.action === "use_vision" || action.action === "done") {
      results.push({ success: true, action });
      continue;
    }

    try {
      const el = action.element ? elements.find(e => e.index === action.element) : null;

      switch (action.action) {
        case "click": {
          if (!el) throw new Error(`Element ${action.element} not found`);
          await page.click(el.selector, { timeout: 5000 });
          await page.waitForTimeout(500);
          break;
        }

        case "fill": {
          if (!el) throw new Error(`Element ${action.element} not found`);
          await page.fill(el.selector, action.value || "", { timeout: 5000 });
          break;
        }

        case "select": {
          if (!el) throw new Error(`Element ${action.element} not found`);
          await page.selectOption(el.selector, action.value || "", { timeout: 5000 });
          break;
        }

        case "keypress": {
          for (const key of action.keys || []) {
            await page.keyboard.press(key);
          }
          await page.waitForTimeout(300);
          break;
        }

        case "scroll": {
          const delta = action.direction === "up" ? -500 : 500;
          await page.mouse.wheel(0, delta);
          await page.waitForTimeout(500);
          break;
        }

        case "wait": {
          await page.waitForTimeout(2000);
          break;
        }

        case "goto": {
          if (action.url) {
            await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(1000);
          }
          break;
        }
      }

      results.push({ success: true, action });
    } catch (err) {
      results.push({
        success: false,
        action,
        error: (err as Error).message,
      });
      // Stop on first failure — will trigger vision fallback
      break;
    }
  }

  return results;
}

export function formatResults(results: ExecutionResult[]): string {
  return results.map(r => {
    const desc = `${r.action.action}${r.action.element ? ` [${r.action.element}]` : ""}${r.action.value ? ` "${r.action.value}"` : ""}`;
    return r.success ? `✓ ${desc}` : `✗ ${desc}: ${r.error}`;
  }).join("\n");
}
