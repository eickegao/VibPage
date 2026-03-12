#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config.js";
import { createAgent } from "./agent.js";
import { App } from "./ui.js";

const BANNER = `
${chalk.cyan.bold("  ╦  ╦╦╔╗ ╔═╗╔═╗╔═╗╔═╗")}
${chalk.cyan.bold("  ╚╗╔╝║╠╩╗╠═╝╠═╣║ ╦║╣ ")}
${chalk.cyan.bold("   ╚╝ ╩╚═╝╩  ╩ ╩╚═╝╚═╝")}
`;

function showWelcome(provider: string, model: string) {
  // Clear screen
  process.stdout.write("\x1B[2J\x1B[H");

  console.log(BANNER);
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
