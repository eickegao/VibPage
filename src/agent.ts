import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import chalk from "chalk";
import type { VibPageConfig } from "./config.js";
import { getApiKey } from "./config.js";
import { type Language, LANGUAGE_LABELS } from "./project-config.js";
import { readFileTool, writeFileTool } from "./tools/file.js";
import { webFetchTool } from "./tools/web-fetch.js";
import { webSearchTool } from "./tools/web-search.js";
import { screenshotTool } from "./tools/screenshot.js";
import { shellExecuteTool } from "./tools/shell.js";
import { initTool } from "./tools/init.js";
import { publishTool } from "./tools/publish.js";
import { pushSocialTool } from "./tools/push-social.js";

export function buildSystemPrompt(language: Language, author?: string): string {
  const langName = LANGUAGE_LABELS[language];
  const authorSection = author
    ? `\n\nAbout the author:\n${author}\n\nWhen writing content, match the author's voice, style, and perspective. Draw on their background and expertise where relevant.`
    : "";
  return `You are VibPage, an AI content creation assistant. You help users write articles, blog posts, and other content, and publish them to the web.

You MUST respond in ${langName} (${language}). All your responses, explanations, and generated content should be in ${langName}.${authorSection}

You have the following tools available:
- read_file / write_file: Read and write local files
- web_fetch: Fetch web page content as Markdown
- web_search: Search the web via DuckDuckGo
- screenshot: Take screenshots of web pages
- shell_execute: Execute shell commands (only safe, non-destructive commands)
- init: Initialize VibPage project (creates config, installs Astro & Wrangler)
- publish: Build and deploy the site to Cloudflare Pages
- push_social: Post content to social media (X/Twitter) using browser automation

When the user asks you to write content:
1. If you need research, use web_search and web_fetch to gather information
2. Write the content in Markdown format
3. Save it using write_file
4. Tell the user where the file was saved

When the user says "发布", "publish", "/publish", or asks to publish/deploy:
1. Use the publish tool
2. If Cloudflare config is missing, ask the user for their API Token, Account ID, and project name
3. Provide the published URL to the user

Be concise and helpful.`;
}

export function createAgent(config: VibPageConfig, language: Language = "zh-CN", author?: string): Agent {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    console.error(
      chalk.red(
        `No API key found. Set ${config.provider.toUpperCase()}_API_KEY environment variable or configure in ~/.vibpage/config.json`
      )
    );
    process.exit(1);
  }

  const model = getModel(config.provider as any, config.model as any);
  const tools = [
    readFileTool,
    writeFileTool,
    webFetchTool,
    webSearchTool,
    screenshotTool,
    shellExecuteTool,
    initTool,
    publishTool,
    pushSocialTool,
  ];

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(language, author),
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
        if ("content" in msg && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if ("type" in part && part.type === "text" && "text" in part) {
              const text = part.text as string;
              const newText = text.slice(currentText.length);
              if (newText) {
                process.stdout.write(newText);
              }
              currentText = text;
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
          chalk.dim(`\n🔧 ${event.toolName}`)
        );
        break;
      case "tool_execution_end":
        console.error(
          chalk.dim(`✓ ${event.toolName} done`)
        );
        break;
    }
  });
}
