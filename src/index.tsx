#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import readline from "readline";
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config.js";
import { createAgent } from "./agent.js";
import { App } from "./ui.js";
import {
  checkAstroInstalled,
  checkWranglerInstalled,
  installPackage,
} from "./tools/init.js";
import {
  projectConfigExists,
  loadProjectConfig,
  saveProjectConfig,
} from "./project-config.js";

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

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function askYesNo(question: string): Promise<boolean> {
  const answer = await ask(question);
  return answer === "y" || answer === "yes";
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

    // Check if already initialized
    if (projectConfigExists()) {
      const cfg = loadProjectConfig();
      console.log(chalk.white(`  Project already initialized in ${process.cwd()}`));
      if (cfg.cloudflare.projectName) {
        console.log(chalk.white(`  Cloudflare project: ${cfg.cloudflare.projectName}`));
      }

      // Check dependencies
      const missingPkgs: string[] = [];
      if (!checkAstroInstalled()) missingPkgs.push("astro");
      if (!checkWranglerInstalled()) missingPkgs.push("wrangler");

      if (missingPkgs.length > 0) {
        console.log(
          chalk.yellow(`\n  Missing packages: ${chalk.white(missingPkgs.join(", "))}`)
        );
        console.log(
          chalk.white("  These are needed for building and deploying your site.")
        );
        const install = await askYesNo(
          chalk.yellow("  Install now? (y/N) ")
        );
        if (install) {
          for (const pkg of missingPkgs) {
            console.log(chalk.rgb(105, 203, 212)(`  Installing ${pkg}...`));
            try {
              await installPackage(pkg);
              console.log(chalk.white(`  ${pkg} installed`));
            } catch (err: any) {
              console.log(chalk.red(`  Failed to install ${pkg}: ${err.message}`));
            }
          }
        } else {
          console.log(
            chalk.white("  Skipped. You can install later when you need to publish.")
          );
        }
      } else {
        console.log(chalk.white("  All dependencies ready"));
      }
    } else {
      // Not initialized — ask user
      console.log(chalk.white(`  Directory: ${process.cwd()}`));
      console.log(chalk.yellow("  This directory has not been initialized as a VibPage project."));
      const doInit = await askYesNo(
        chalk.yellow("  Initialize now? (y/N) ")
      );
      if (!doInit) {
        console.log(chalk.yellow("  Exiting. Run vibpage again when ready."));
        process.exit(0);
      }

      // Create config
      console.log(chalk.white("  Creating .vibpage.json..."));
      saveProjectConfig(loadProjectConfig());
      console.log(chalk.white("  Done"));

      // Ask about dependencies
      console.log(
        chalk.white("\n  To build and deploy sites, you need Astro and Wrangler.")
      );
      const install = await askYesNo(
        chalk.yellow("  Install them now? (y/N) ")
      );
      if (install) {
        for (const pkg of ["astro", "wrangler"]) {
          console.log(chalk.rgb(105, 203, 212)(`  Installing ${pkg}...`));
          try {
            await installPackage(pkg);
            console.log(chalk.white(`  ${pkg} installed`));
          } catch (err: any) {
            console.log(chalk.red(`  Failed to install ${pkg}: ${err.message}`));
          }
        }
      } else {
        console.log(
          chalk.white("  Skipped. You can install later when you need to publish.")
        );
      }
    }
    console.log("");

    const agent = createAgent(config);

    render(
      <App agent={agent} config={{ provider: config.provider, model: config.model }} />
    );
  });

program.parse();
