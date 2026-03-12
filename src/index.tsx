#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import readline from "readline";
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config.js";
import { createAgent } from "./agent.js";
import { App } from "./ui.js";
import { initTool } from "./tools/init.js";

// 5 gradient anchor colors (teal to light cyan)
const COLORS: [number, number, number][] = [
  [38, 170, 185],
  [65, 186, 199],
  [105, 203, 212],
  [151, 220, 226],
  [201, 237, 240],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function interpolateColor(t: number): [number, number, number] {
  // t is 0..1, map to 4 segments between 5 anchor colors
  const seg = t * (COLORS.length - 1);
  const i = Math.min(Math.floor(seg), COLORS.length - 2);
  const f = seg - i;
  return [
    lerp(COLORS[i][0], COLORS[i + 1][0], f),
    lerp(COLORS[i][1], COLORS[i + 1][1], f),
    lerp(COLORS[i][2], COLORS[i + 1][2], f),
  ];
}

function gradientLine(line: string): string {
  // Find first and last non-space character positions for even distribution
  const totalLen = line.length;
  let result = "";
  for (let i = 0; i < totalLen; i++) {
    const ch = line[i];
    if (ch === " ") {
      result += ch;
    } else {
      const t = totalLen > 1 ? i / (totalLen - 1) : 0;
      const [r, g, b] = interpolateColor(t);
      result += chalk.rgb(r, g, b).bold(ch);
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

function askTrust(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const cwd = process.cwd();
    rl.question(
      chalk.yellow(`  Do you trust this directory? ${chalk.white(cwd)} (y/N) `),
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "y");
      }
    );
  });
}

function showWelcome(provider: string, model: string) {
  process.stdout.write("\x1B[2J\x1B[H");

  console.log("");
  for (const line of BANNER_LINES) {
    console.log(gradientLine(line));
  }
  console.log("");
  console.log(chalk.rgb(151, 220, 226)("  AI-powered content creation\n"));
  console.log(chalk.white("  Tips:"));
  console.log(chalk.white("  1. Ask me to write articles, blog posts, or any content."));
  console.log(chalk.white("  2. I can search the web and fetch pages for research."));
  console.log(chalk.white("  3. I can take screenshots of web pages."));
  console.log(chalk.white('  4. Type "exit" to quit.\n'));
  console.log(chalk.rgb(105, 203, 212)(`  Using: ${provider}/${model}\n`));
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

    // Trust confirmation
    const trusted = await askTrust();
    if (!trusted) {
      console.log(chalk.yellow("  Exiting. Run vibpage in a directory you trust."));
      process.exit(0);
    }

    // Auto init
    console.log(chalk.rgb(105, 203, 212)("  Initializing project..."));
    try {
      const result = await initTool.execute("auto-init", {});
      const text = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      for (const line of text.split("\n")) {
        console.log(chalk.white(`  ${line}`));
      }
      console.log("");
    } catch (err: any) {
      console.log(chalk.red(`  Init failed: ${err.message}\n`));
    }

    const agent = createAgent(config);

    render(
      <App agent={agent} config={{ provider: config.provider, model: config.model }} />
    );
  });

program.parse();
