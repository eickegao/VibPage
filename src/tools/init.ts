import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  projectConfigExists,
  loadProjectConfig,
  saveProjectConfig,
} from "../project-config.js";

export function checkAstroInstalled(): boolean {
  return existsSync(join(process.cwd(), "node_modules", "astro"));
}

export function checkWranglerInstalled(): boolean {
  return existsSync(join(process.cwd(), "node_modules", "wrangler"));
}

export function installPackage(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", name, "--save-dev"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install ${name} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

const initParams = Type.Object({});

export const initTool: AgentTool<typeof initParams> = {
  name: "init",
  label: "Initialize Project",
  description:
    "Initialize a VibPage project: creates .vibpage.json config if missing. Reports whether Astro and Wrangler are installed. Does NOT automatically install packages — ask the user first.",
  parameters: initParams,
  execute: async () => {
    const results: string[] = [];

    // Config file
    if (projectConfigExists()) {
      const config = loadProjectConfig();
      results.push("Found existing .vibpage.json");
      results.push(`  Cloudflare project: ${config.cloudflare.projectName || "(not set)"}`);
    } else {
      const config = loadProjectConfig();
      saveProjectConfig(config);
      results.push("Created .vibpage.json with default settings");
    }

    // Check status only — don't install
    if (checkAstroInstalled()) {
      results.push("Astro: installed");
    } else {
      results.push("Astro: not installed (needed for building sites)");
    }

    if (checkWranglerInstalled()) {
      results.push("Wrangler: installed");
    } else {
      results.push("Wrangler: not installed (needed for deploying to Cloudflare)");
    }

    return {
      content: [{ type: "text", text: results.join("\n") }],
      details: {},
    };
  },
};
