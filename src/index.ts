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
