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
import { browserTaskTool } from "./tools/browser-task.js";
import { actionSaveTool, actionListTool, actionRunTool, actionDeleteTool } from "./tools/action.js";


export function buildSystemPrompt(language: Language): string {
  const langName = LANGUAGE_LABELS[language];
  return `You are VibPage, an AI-powered RPA (Robotic Process Automation) assistant. You help users automate web browser tasks — all from the command line.

You MUST respond in ${langName} (${language}). All your responses, explanations, and generated content should be in ${langName}.

You have the following tools available:
- read_file / write_file: Read and write local files
- web_fetch: Fetch web page content as Markdown
- web_search: Search the web via DuckDuckGo
- screenshot: Take screenshots of web pages
- shell_execute: Execute shell commands
- browser_task: Execute any task in a web browser using AI vision and automation (powered by OpenAI Computer Use). It can interact with any website: fill forms, post to social media, download reports, click buttons, navigate menus, etc.
- action_save: Save a reusable automation action (name, URL, parameters, steps)
- action_list: List all saved actions
- action_run: Run a saved action with parameters
- action_delete: Delete a saved action

## Actions
Actions are reusable browser automation workflows. They are the most powerful feature of VibPage.

When creating an action:
1. The user will explain the task step by step
2. You help organize it into clear steps
3. Test each step using browser_task
4. When the user confirms it works, save it with action_save
5. Steps should use {parameter_name} syntax for variable parts (e.g. "Type {content} into the text area")

When running an action:
1. Use action_run to load the action definition and resolve parameters
2. Then use browser_task to execute it step by step following the instructions
3. Report the result

When the user describes a web automation task:
1. Understand what website and what actions are needed
2. Use browser_task with the target URL and a clear task description
3. The browser will open visibly so the user can monitor
4. Login sessions are preserved across runs

Be concise and helpful.`;
}

export function createAgent(config: VibPageConfig, language: Language = "zh-CN"): Agent {
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
    browserTaskTool,
    actionSaveTool,
    actionListTool,
    actionRunTool,
    actionDeleteTool,
  ];

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(language),
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
