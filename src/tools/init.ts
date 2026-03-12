import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  projectConfigExists,
  loadProjectConfig,
  saveProjectConfig,
} from "../project-config.js";

const initParams = Type.Object({});

export const initTool: AgentTool<typeof initParams> = {
  name: "init",
  label: "Initialize Project",
  description:
    "Initialize a VibPage project: creates .vibpage.json config if missing and installs Astro if needed.",
  parameters: initParams,
  execute: async () => {
    const results: string[] = [];

    // Step 1: Config file
    if (projectConfigExists()) {
      const config = loadProjectConfig();
      results.push("Found existing .vibpage.json");
      results.push(`  Cloudflare project: ${config.cloudflare.projectName || "(not set)"}`);
    } else {
      const config = loadProjectConfig(); // returns defaults
      saveProjectConfig(config);
      results.push("Created .vibpage.json with default settings");
    }

    // Step 2: Check/install Astro
    const nodeModulesAstro = join(process.cwd(), "node_modules", "astro");
    if (existsSync(nodeModulesAstro)) {
      results.push("Astro is already installed");
    } else {
      results.push("Installing Astro...");
      try {
        execSync("npm install astro --save-dev", {
          cwd: process.cwd(),
          stdio: "pipe",
        });
        results.push("Astro installed successfully");
      } catch (err: any) {
        results.push(`Failed to install Astro: ${err.message}`);
      }
    }

    // Step 3: Check/install wrangler
    const nodeModulesWrangler = join(process.cwd(), "node_modules", "wrangler");
    if (existsSync(nodeModulesWrangler)) {
      results.push("Wrangler is already installed");
    } else {
      results.push("Installing Wrangler...");
      try {
        execSync("npm install wrangler --save-dev", {
          cwd: process.cwd(),
          stdio: "pipe",
        });
        results.push("Wrangler installed successfully");
      } catch (err: any) {
        results.push(`Failed to install Wrangler: ${err.message}`);
      }
    }

    return {
      content: [{ type: "text", text: results.join("\n") }],
      details: {},
    };
  },
};
