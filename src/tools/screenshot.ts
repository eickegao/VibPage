import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { resolve, relative } from "path";

const screenshotParams = Type.Object({
  url: Type.String({ description: "URL to screenshot" }),
  filename: Type.Optional(
    Type.String({
      description:
        "Output filename (default: screenshot-<timestamp>.png)",
    })
  ),
});

export const screenshotTool: AgentTool<typeof screenshotParams> = {
  name: "screenshot",
  label: "Screenshot",
  description:
    "Take a screenshot of a web page and save it as a PNG file in the current directory.",
  parameters: screenshotParams,
  execute: async (_toolCallId, params) => {
    let chromium;
    try {
      const pw = await import("playwright");
      chromium = pw.chromium;
    } catch {
      throw new Error(
        "Playwright not available. Run: npx playwright install chromium"
      );
    }

    const filename = params.filename || `screenshot-${Date.now()}.png`;
    const filePath = resolve(filename);

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });
      await page.goto(params.url, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.screenshot({ path: filePath, fullPage: true });
    } finally {
      await browser.close();
    }

    return {
      content: [
        {
          type: "text",
          text: `Screenshot saved: ${relative(process.cwd(), filePath)}`,
        },
      ],
      details: {},
    };
  },
};
