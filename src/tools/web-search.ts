import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Search failed: HTTP ${response.status}`);
  }
  const html = await response.text();
  const results: SearchResult[] = [];

  const resultBlocks = html.split('class="result__a"');
  for (let i = 1; i < resultBlocks.length && results.length < 10; i++) {
    const block = resultBlocks[i];
    const hrefMatch = block.match(/href="([^"]+)"/);
    const titleMatch = block.match(/>([^<]+)<\/a>/);
    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/
    );

    if (hrefMatch && titleMatch) {
      let resultUrl = hrefMatch[1];
      const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        resultUrl = decodeURIComponent(uddgMatch[1]);
      }
      results.push({
        title: titleMatch[1].trim(),
        url: resultUrl,
        snippet: snippetMatch
          ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
          : "",
      });
    }
  }
  return results;
}

const webSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
});

export const webSearchTool: AgentTool<typeof webSearchParams> = {
  name: "web_search",
  label: "Web Search",
  description:
    "Search the web using DuckDuckGo and return a list of results with titles, URLs, and snippets. Use web_fetch to read specific results.",
  parameters: webSearchParams,
  execute: async (_toolCallId, params) => {
    const results = await searchDuckDuckGo(params.query);
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: "No search results found." }],
        details: {},
      };
    }
    const formatted = results
      .map(
        (r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
      )
      .join("\n\n");
    return {
      content: [{ type: "text", text: formatted }],
      details: {},
    };
  },
};
