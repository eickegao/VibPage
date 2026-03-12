#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config.js";
import { createAgent } from "./agent.js";
import { App } from "./ui.js";

// Blue-green gradient colors (left to right)
const G = [
  "#0066FF", "#0077EE", "#0088DD", "#0099CC",
  "#00AABB", "#00BBAA", "#00CC99", "#00DD88",
];

function gradientLine(line: string, colors: string[]): string {
  let result = "";
  let ci = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") {
      result += ch;
    } else {
      const color = colors[Math.min(ci, colors.length - 1)];
      result += chalk.hex(color).bold(ch);
      ci++;
    }
  }
  return result;
}

// Large ASCII art using block characters
const BANNER_LINES = [
  " ██╗   ██╗ ██╗ ██████╗  ██████╗   █████╗   ██████╗  ███████╗",
  " ██║   ██║ ██║ ██╔══██╗ ██╔══██╗ ██╔══██╗ ██╔════╝  ██╔════╝",
  " ██║   ██║ ██║ ██████╔╝ ██████╔╝ ███████║ ██║  ███╗ █████╗  ",
  " ╚██╗ ██╔╝ ██║ ██╔══██╗ ██╔═══╝  ██╔══██║ ██║   ██║ ██╔══╝  ",
  "  ╚████╔╝  ██║ ██████╔╝ ██║      ██║  ██║ ╚██████╔╝ ███████╗",
  "   ╚═══╝   ╚═╝ ╚═════╝  ╚═╝      ╚═╝  ╚═╝  ╚═════╝  ╚══════╝",
];

function showWelcome(provider: string, model: string) {
  process.stdout.write("\x1B[2J\x1B[H");

  console.log("");
  for (const line of BANNER_LINES) {
    console.log(gradientLine(line, G));
  }
  console.log("");
  console.log(chalk.dim("  AI-powered content creation\n"));
  console.log(chalk.dim("  Tips:"));
  console.log(chalk.dim("  1. Ask me to write articles, blog posts, or any content."));
  console.log(chalk.dim("  2. I can search the web and fetch pages for research."));
  console.log(chalk.dim("  3. I can take screenshots of web pages."));
  console.log(chalk.dim('  4. Type "exit" to quit.\n'));
  console.log(chalk.dim(`  Using: ${provider}/${model}\n`));
}

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

    showWelcome(config.provider, config.model);

    const agent = createAgent(config);

    render(
      <App agent={agent} config={{ provider: config.provider, model: config.model }} />
    );
  });

program.parse();
