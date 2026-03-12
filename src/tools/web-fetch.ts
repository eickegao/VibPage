import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const webFetchParams = Type.Object({
  url: Type.String({ description: "URL to fetch" }),
});

export const webFetchTool: AgentTool<typeof webFetchParams> = {
  name: "web_fetch",
  label: "Web Fetch",
  description:
    "Fetch a web page and return its content as Markdown. Useful for reading documentation, articles, and reference material.",
  parameters: webFetchParams,
  execute: async (_toolCallId, params) => {
    const response = await fetch(params.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; VibPage/0.1; +https://vibpage.com)",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();

    const text = contentType.includes("text/html")
      ? htmlToMarkdown(body)
      : body;

    const maxLength = 50000;
    const truncated =
      text.length > maxLength
        ? text.slice(0, maxLength) + "\n\n[Content truncated]"
        : text;

    return {
      content: [{ type: "text", text: truncated }],
      details: {},
    };
  },
};
