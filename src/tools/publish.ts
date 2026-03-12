import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  loadProjectConfig,
  saveProjectConfig,
  hasCloudflareConfig,
} from "../project-config.js";

const publishParams = Type.Object({
  apiToken: Type.Optional(
    Type.String({ description: "Cloudflare API Token (if not already configured)" })
  ),
  accountId: Type.Optional(
    Type.String({ description: "Cloudflare Account ID (if not already configured)" })
  ),
  projectName: Type.Optional(
    Type.String({ description: "Cloudflare Pages project name (if not already configured)" })
  ),
});

export const publishTool: AgentTool<typeof publishParams> = {
  name: "publish",
  label: "Publish to Cloudflare Pages",
  description:
    "Build the site with Astro and deploy to Cloudflare Pages. If Cloudflare credentials are missing, provide them as parameters and they will be saved to .vibpage.json.",
  parameters: publishParams,
  execute: async (_toolCallId, params) => {
    const config = loadProjectConfig();

    // Update config with provided params
    if (params.apiToken) config.cloudflare.apiToken = params.apiToken;
    if (params.accountId) config.cloudflare.accountId = params.accountId;
    if (params.projectName) config.cloudflare.projectName = params.projectName;

    // Check required config
    if (!hasCloudflareConfig(config)) {
      const missing: string[] = [];
      if (!config.cloudflare.apiToken) missing.push("apiToken");
      if (!config.cloudflare.accountId) missing.push("accountId");
      if (!config.cloudflare.projectName) missing.push("projectName");
      return {
        content: [
          {
            type: "text",
            text: `Missing Cloudflare configuration: ${missing.join(", ")}. Please provide these values. The user can find them in their Cloudflare dashboard:\n- apiToken: Create at https://dash.cloudflare.com/profile/api-tokens (needs Cloudflare Pages Edit permission)\n- accountId: Found on the Cloudflare dashboard overview page\n- projectName: The name for the Cloudflare Pages project (will be used as subdomain)`,
          },
        ],
        details: {},
      };
    }

    // Save updated config
    saveProjectConfig(config);

    const results: string[] = [];

    // Step 1: Ensure Astro content directory exists
    const contentDir = join(process.cwd(), "src", "content");
    if (!existsSync(contentDir)) {
      mkdirSync(contentDir, { recursive: true });
      results.push("Created src/content/ directory");
    }

    // Step 2: Copy markdown files to content directory
    const cwd = process.cwd();
    const mdFiles = readdirSync(cwd).filter(
      (f) => f.endsWith(".md") && f !== "README.md" && f !== "CLAUDE.md"
    );
    for (const file of mdFiles) {
      copyFileSync(join(cwd, file), join(contentDir, file));
    }
    results.push(`Copied ${mdFiles.length} markdown file(s) to src/content/`);

    // Step 3: Build with Astro
    results.push("Building with Astro...");
    try {
      execSync("npx astro build", {
        cwd: process.cwd(),
        stdio: "pipe",
        env: { ...process.env },
      });
      results.push("Astro build completed");
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message;
      return {
        content: [
          {
            type: "text",
            text: `Build failed:\n${stderr}\n\nMake sure Astro is installed (run init first) and you have a valid Astro project setup.`,
          },
        ],
        details: {},
      };
    }

    // Step 4: Deploy to Cloudflare Pages
    const distDir = resolve(cwd, "dist");
    if (!existsSync(distDir)) {
      return {
        content: [
          {
            type: "text",
            text: "Build output directory (dist/) not found. The Astro build may have failed silently.",
          },
        ],
        details: {},
      };
    }

    results.push("Deploying to Cloudflare Pages...");
    try {
      const output = execSync(
        `npx wrangler pages deploy dist --project-name ${config.cloudflare.projectName}`,
        {
          cwd: process.cwd(),
          stdio: "pipe",
          env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: config.cloudflare.apiToken,
            CLOUDFLARE_ACCOUNT_ID: config.cloudflare.accountId,
          },
        }
      );
      const deployOutput = output.toString();
      results.push("Deployment successful!");
      results.push(deployOutput);
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message;
      return {
        content: [
          {
            type: "text",
            text: `Deployment failed:\n${stderr}`,
          },
        ],
        details: {},
      };
    }

    return {
      content: [{ type: "text", text: results.join("\n") }],
      details: {},
    };
  },
};
