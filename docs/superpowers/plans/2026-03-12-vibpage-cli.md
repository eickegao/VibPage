# VibPage CLI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conversational AI agent CLI for content creation with web fetch, search, screenshot, and shell tools.

**Architecture:** Node.js + TypeScript CLI using `@mariozechner/pi-ai` for multi-model LLM support and `@mariozechner/pi-agent-core` for the agent runtime. Tools are registered as `AgentTool` instances. User interacts via readline-based REPL.

**Tech Stack:** TypeScript, pi-ai, pi-agent-core, Playwright (Chromium), turndown, commander, chalk

---

## File Structure

```
vibpage/
├── package.json              # Project config, dependencies, bin entry
├── tsconfig.json             # TypeScript config
├── src/
│   ├── index.ts              # CLI entry point (commander + REPL)
│   ├── agent.ts              # Agent setup, tool registration, event handling
│   ├── config.ts             # Config loading/saving (~/.vibpage/config.json)
│   ├── tools/
│   │   ├── file.ts           # read_file / write_file tools
│   │   ├── web-fetch.ts      # web_fetch tool
│   │   ├── web-search.ts     # web_search tool (DuckDuckGo)
│   │   ├── screenshot.ts     # screenshot tool (Playwright)
│   │   └── shell.ts          # shell_execute tool
│   └── utils/
│       └── html-to-md.ts     # HTML to Markdown conversion
└── CLAUDE.md                 # Project instructions
```

---

## Chunk 1: Project Scaffolding + Config

### Task 1: Initialize project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `CLAUDE.md`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "vibpage",
  "version": "0.1.0",
  "description": "AI-powered content creation CLI",
  "type": "module",
  "bin": {
    "vibpage": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js"
  },
  "keywords": ["ai", "markdown", "cli", "content"],
  "license": "MIT"
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create CLAUDE.md**

```markdown
# VibPage CLI

AI-powered content creation CLI tool.

## Tech Stack
- Node.js + TypeScript
- @mariozechner/pi-ai + pi-agent-core for multi-model LLM
- Playwright for screenshots
- turndown for HTML-to-Markdown

## Commands
- `npm run build` — compile TypeScript
- `npm run dev` — watch mode
- `npm start` — run CLI

## Project Structure
- src/index.ts — CLI entry point
- src/agent.ts — Agent setup and event loop
- src/config.ts — Config management
- src/tools/ — AI agent tools
- src/utils/ — Utilities
```

- [ ] **Step 4: Install dependencies**

```bash
npm install @mariozechner/pi-ai @mariozechner/pi-agent-core playwright turndown commander chalk
npm install -D typescript @types/node @types/turndown
```

- [ ] **Step 5: Create src directory structure**

```bash
mkdir -p src/tools src/utils
```

- [ ] **Step 6: Commit**

```bash
git init
echo "node_modules/\ndist/\n.DS_Store" > .gitignore
git add .
git commit -m "chore: initialize vibpage cli project"
```

### Task 2: Config module

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Implement config module**

```typescript
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface VibPageConfig {
  provider: "anthropic" | "openai" | "google";
  model: string;
  apiKey: string;
  outputDir: string;
}

const DEFAULT_CONFIG: VibPageConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  apiKey: "",
  outputDir: ".",
};

const CONFIG_DIR = join(homedir(), ".vibpage");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function loadConfig(): VibPageConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: VibPageConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600);
}

export function getApiKey(config: VibPageConfig): string {
  const envKeys: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
  };
  return process.env[envKeys[config.provider]] || config.apiKey;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add config module with API key management"
```

---

## Chunk 2: Tools Implementation

### Task 3: HTML-to-Markdown utility

**Files:**
- Create: `src/utils/html-to-md.ts`

- [ ] **Step 1: Implement HTML-to-Markdown conversion**

```typescript
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Remove script and style tags
turndown.remove(["script", "style", "nav", "footer", "header"]);

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/html-to-md.ts
git commit -m "feat: add HTML to Markdown conversion utility"
```

### Task 4: File read/write tool

**Files:**
- Create: `src/tools/file.ts`

- [ ] **Step 1: Implement file tools**

```typescript
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

function isWithinWorkDir(filePath: string): boolean {
  const abs = resolve(filePath);
  const cwd = process.cwd();
  return abs.startsWith(cwd);
}

export const readFileTool: AgentTool = {
  name: "read_file",
  description:
    "Read the contents of a file. Paths are relative to the current working directory.",
  parameters: Type.Object({
    path: Type.String({ description: "File path to read" }),
  }),
  execute: async (_toolCallId, params) => {
    const filePath = resolve(params.path);
    if (!isWithinWorkDir(filePath)) {
      throw new Error(
        `Access denied: ${params.path} is outside the working directory`
      );
    }
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${params.path}`);
    }
    const content = readFileSync(filePath, "utf-8");
    return {
      content: [{ type: "text", text: content }],
    };
  },
};

export const writeFileTool: AgentTool = {
  name: "write_file",
  description:
    "Write content to a file. Creates the file if it does not exist. Paths are relative to the current working directory.",
  parameters: Type.Object({
    path: Type.String({ description: "File path to write to" }),
    content: Type.String({ description: "Content to write" }),
  }),
  execute: async (_toolCallId, params) => {
    const filePath = resolve(params.path);
    if (!isWithinWorkDir(filePath)) {
      throw new Error(
        `Access denied: ${params.path} is outside the working directory`
      );
    }
    writeFileSync(filePath, params.content, "utf-8");
    return {
      content: [
        { type: "text", text: `File written: ${relative(process.cwd(), filePath)}` },
      ],
    };
  },
};
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/file.ts
git commit -m "feat: add file read/write tools with workdir restriction"
```

### Task 5: Web Fetch tool

**Files:**
- Create: `src/tools/web-fetch.ts`

- [ ] **Step 1: Implement web fetch tool**

```typescript
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { htmlToMarkdown } from "../utils/html-to-md.js";

export const webFetchTool: AgentTool = {
  name: "web_fetch",
  description:
    "Fetch a web page and return its content as Markdown. Useful for reading documentation, articles, and reference material.",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch" }),
  }),
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

    // Truncate very long content
    const maxLength = 50000;
    const truncated =
      text.length > maxLength
        ? text.slice(0, maxLength) + "\n\n[Content truncated]"
        : text;

    return {
      content: [{ type: "text", text: truncated }],
    };
  },
};
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/web-fetch.ts
git commit -m "feat: add web fetch tool with HTML-to-Markdown conversion"
```

### Task 6: Web Search tool

**Files:**
- Create: `src/tools/web-search.ts`

- [ ] **Step 1: Implement DuckDuckGo search tool**

```typescript
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { htmlToMarkdown } from "../utils/html-to-md.js";

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

  // Parse DuckDuckGo HTML results
  // Each result is in a div with class "result"
  const resultBlocks = html.split('class="result__a"');
  for (let i = 1; i < resultBlocks.length && results.length < 10; i++) {
    const block = resultBlocks[i];
    // Extract URL
    const hrefMatch = block.match(/href="([^"]+)"/);
    // Extract title - text before closing </a>
    const titleMatch = block.match(/>([^<]+)<\/a>/);
    // Extract snippet
    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/
    );

    if (hrefMatch && titleMatch) {
      let resultUrl = hrefMatch[1];
      // DuckDuckGo wraps URLs in a redirect
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

export const webSearchTool: AgentTool = {
  name: "web_search",
  description:
    "Search the web using DuckDuckGo and return a list of results with titles, URLs, and snippets. Use web_fetch to read specific results.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
  }),
  execute: async (_toolCallId, params) => {
    const results = await searchDuckDuckGo(params.query);
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: "No search results found." }],
      };
    }
    const formatted = results
      .map(
        (r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
      )
      .join("\n\n");
    return {
      content: [{ type: "text", text: formatted }],
    };
  },
};
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/web-search.ts
git commit -m "feat: add web search tool via DuckDuckGo HTML scraping"
```

### Task 7: Screenshot tool

**Files:**
- Create: `src/tools/screenshot.ts`

- [ ] **Step 1: Implement screenshot tool**

```typescript
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { resolve, relative } from "path";

export const screenshotTool: AgentTool = {
  name: "screenshot",
  description:
    "Take a screenshot of a web page and save it as a PNG file in the current directory.",
  parameters: Type.Object({
    url: Type.String({ description: "URL to screenshot" }),
    filename: Type.Optional(
      Type.String({
        description:
          "Output filename (default: screenshot-<timestamp>.png)",
      })
    ),
  }),
  execute: async (_toolCallId, params) => {
    // Dynamic import to avoid loading Playwright until needed
    let chromium;
    try {
      const pw = await import("playwright");
      chromium = pw.chromium;
    } catch {
      throw new Error(
        "Playwright not available. Run: npx playwright install chromium"
      );
    }

    const filename =
      params.filename || `screenshot-${Date.now()}.png`;
    const filePath = resolve(filename);

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(params.url, { waitUntil: "networkidle", timeout: 30000 });
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
    };
  },
};
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/screenshot.ts
git commit -m "feat: add screenshot tool using Playwright"
```

### Task 8: Shell execute tool

**Files:**
- Create: `src/tools/shell.ts`

- [ ] **Step 1: Implement shell execute tool**

```typescript
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execSync } from "child_process";
import * as readline from "readline";

async function confirmExecution(command: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(`\n⚡ Execute: ${command}\n  Allow? (y/n) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export const shellExecuteTool: AgentTool = {
  name: "shell_execute",
  description:
    "Execute a shell command and return its output. The user will be asked to confirm before execution.",
  parameters: Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
  }),
  execute: async (_toolCallId, params) => {
    const allowed = await confirmExecution(params.command);
    if (!allowed) {
      return {
        content: [{ type: "text", text: "Command execution denied by user." }],
      };
    }
    try {
      const output = execSync(params.command, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: process.cwd(),
      });
      return {
        content: [{ type: "text", text: output || "(no output)" }],
      };
    } catch (err: any) {
      throw new Error(
        `Command failed (exit ${err.status}): ${err.stderr || err.message}`
      );
    }
  },
};
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/shell.ts
git commit -m "feat: add shell execute tool with user confirmation"
```

---

## Chunk 3: Agent + CLI Entry Point

### Task 9: Agent module

**Files:**
- Create: `src/agent.ts`

- [ ] **Step 1: Implement agent setup and event handling**

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import chalk from "chalk";
import type { VibPageConfig } from "./config.js";
import { getApiKey } from "./config.js";
import { readFileTool, writeFileTool } from "./tools/file.js";
import { webFetchTool } from "./tools/web-fetch.js";
import { webSearchTool } from "./tools/web-search.js";
import { screenshotTool } from "./tools/screenshot.js";
import { shellExecuteTool } from "./tools/shell.js";

const SYSTEM_PROMPT = `You are VibPage, an AI content creation assistant. You help users write articles, blog posts, and other content.

You have the following tools available:
- read_file / write_file: Read and write local files
- web_fetch: Fetch web page content as Markdown
- web_search: Search the web via DuckDuckGo
- screenshot: Take screenshots of web pages
- shell_execute: Execute shell commands (requires user confirmation)

When the user asks you to write content:
1. If you need research, use web_search and web_fetch to gather information
2. Write the content in Markdown format
3. Save it using write_file
4. Tell the user where the file was saved

Always write in the language the user uses. Be concise and helpful.`;

export function createAgent(config: VibPageConfig): Agent {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    console.error(
      chalk.red(
        `No API key found. Set ${config.provider.toUpperCase()}_API_KEY environment variable or run: vibpage --config`
      )
    );
    process.exit(1);
  }

  const model = getModel(config.provider, config.model);
  const tools = [
    readFileTool,
    writeFileTool,
    webFetchTool,
    webSearchTool,
    screenshotTool,
    shellExecuteTool,
  ];

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools,
    },
    getApiKey: () => apiKey,
  });

  return agent;
}

export function setupEventHandlers(agent: Agent): void {
  let currentText = "";

  agent.subscribe((event) => {
    switch (event.type) {
      case "message_start":
        currentText = "";
        break;
      case "message_update": {
        const msg = event.message;
        if (msg.content) {
          for (const part of msg.content) {
            if (part.type === "text") {
              const newText = part.text.slice(currentText.length);
              if (newText) {
                process.stdout.write(newText);
              }
              currentText = part.text;
            }
          }
        }
        break;
      }
      case "message_end":
        process.stdout.write("\n");
        break;
      case "tool_execution_start":
        console.error(
          chalk.dim(`\n🔧 ${event.toolName}(${JSON.stringify(event.args)})`)
        );
        break;
      case "tool_execution_end":
        console.error(chalk.dim(`✓ ${event.toolName} done`));
        break;
    }
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/agent.ts
git commit -m "feat: add agent module with tool registration and event streaming"
```

### Task 10: CLI entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement CLI entry point with REPL**

```typescript
#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import * as readline from "readline";
import { loadConfig } from "./config.js";
import { createAgent, setupEventHandlers } from "./agent.js";

program
  .name("vibpage")
  .description("AI-powered content creation CLI")
  .version("0.1.0")
  .option("-m, --model <model>", "AI model to use")
  .option("-p, --provider <provider>", "AI provider (anthropic/openai/google)")
  .option("-o, --output <dir>", "Output directory")
  .action(async (options) => {
    const config = loadConfig();

    if (options.provider) config.provider = options.provider;
    if (options.model) config.model = options.model;
    if (options.output) config.outputDir = options.output;

    console.log(chalk.bold("\n✨ VibPage - AI Content Creation\n"));
    console.log(
      chalk.dim(
        `Model: ${config.provider}/${config.model} | Output: ${config.outputDir}`
      )
    );
    console.log(chalk.dim('Type your request, or "exit" to quit.\n'));

    const agent = createAgent(config);
    setupEventHandlers(agent);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = () => {
      rl.question(chalk.green("> "), async (input) => {
        const trimmed = input.trim();
        if (!trimmed) {
          prompt();
          return;
        }
        if (trimmed === "exit" || trimmed === "quit") {
          console.log(chalk.dim("\nBye! 👋"));
          rl.close();
          process.exit(0);
        }

        try {
          await agent.prompt(trimmed);
          await agent.waitForIdle();
        } catch (err: any) {
          console.error(chalk.red(`\nError: ${err.message}`));
        }

        prompt();
      });
    };

    prompt();
  });

program.parse();
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

- [ ] **Step 3: Test run**

```bash
node dist/index.js --help
```

Expected output: help text with options.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry point with interactive REPL"
```

### Task 11: Integration test — end to end

- [ ] **Step 1: Build the project**

```bash
npm run build
```

- [ ] **Step 2: Test CLI starts correctly**

```bash
ANTHROPIC_API_KEY=test node dist/index.js --help
```

Expected: shows help text without errors.

- [ ] **Step 3: Link for global testing**

```bash
npm link
```

Now `vibpage` command is available globally for manual testing.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete vibpage cli v0.1.0"
```
