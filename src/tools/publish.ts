import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { join, resolve, basename } from "path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  loadProjectConfig,
  saveProjectConfig,
} from "../project-config.js";

function isWranglerLoggedIn(): boolean {
  try {
    const result = spawnSync("npx", ["wrangler", "whoami"], {
      cwd: process.cwd(),
      stdio: "pipe",
      timeout: 15000,
    });
    const output = result.stdout?.toString() || "";
    // "You are logged in" is the definitive signal
    return output.includes("You are logged in");
  } catch {
    return false;
  }
}

function wranglerLogin(): { success: boolean; error?: string } {
  try {
    // wrangler login opens browser for OAuth, stdio: inherit so user sees it
    const result = spawnSync("npx", ["wrangler", "login"], {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 120000,
    });
    return { success: result.status === 0 };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function getAccountId(): string | null {
  try {
    const result = spawnSync("npx", ["wrangler", "whoami"], {
      cwd: process.cwd(),
      stdio: "pipe",
      timeout: 15000,
    });
    const output = result.stdout?.toString() || "";
    // Parse account ID from whoami output
    const match = output.match(/([0-9a-f]{32})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const publishParams = Type.Object({
  projectName: Type.Optional(
    Type.String({ description: "Cloudflare Pages project name (if not already configured)" })
  ),
});

export const publishTool: AgentTool<typeof publishParams> = {
  name: "publish",
  label: "Publish to Cloudflare Pages",
  description:
    "Build the site with Astro and deploy to Cloudflare Pages. Uses 'wrangler login' for browser-based OAuth if not logged in. Only needs a project name.",
  parameters: publishParams,
  execute: async (_toolCallId, params) => {
    const config = loadProjectConfig();
    const results: string[] = [];

    // Update project name if provided
    if (params.projectName) {
      config.cloudflare.projectName = params.projectName;
      saveProjectConfig(config);
    }

    // Step 1: Check wrangler login status
    if (!isWranglerLoggedIn()) {
      results.push("Not logged in to Cloudflare. Opening browser for authorization...");
      const login = wranglerLogin();
      if (!login.success) {
        return {
          content: [{
            type: "text",
            text: `Cloudflare login failed${login.error ? `: ${login.error}` : ""}. Please try again.`,
          }],
          details: {},
        };
      }
      results.push("Cloudflare login successful!");
    } else {
      results.push("Already logged in to Cloudflare");
    }

    // Step 2: Get account ID
    const accountId = getAccountId();
    if (!accountId) {
      return {
        content: [{
          type: "text",
          text: "Could not retrieve Cloudflare Account ID. Please run 'npx wrangler login' manually and try again.",
        }],
        details: {},
      };
    }
    results.push(`Account ID: ${accountId}`);

    // Step 3: Check project name — default to directory name
    if (!config.cloudflare.projectName) {
      const defaultName = basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, "-");
      return {
        content: [{
          type: "text",
          text: `Cloudflare login is ready. No project name is configured yet.\n\nThe default project name based on the current directory is: "${defaultName}"\nThis will be your subdomain: ${defaultName}.pages.dev\n\nAsk the user if "${defaultName}" is OK, or if they'd like a different name. Then call publish again with the chosen projectName.`,
        }],
        details: {},
      };
    }

    // Step 4: Ensure Astro content directory exists
    const contentDir = join(process.cwd(), "src", "content");
    if (!existsSync(contentDir)) {
      mkdirSync(contentDir, { recursive: true });
      results.push("Created src/content/ directory");
    }

    // Step 5: Copy markdown files to content directory
    const cwd = process.cwd();
    const mdFiles = readdirSync(cwd).filter(
      (f) => f.endsWith(".md") && f !== "README.md" && f !== "CLAUDE.md"
    );
    for (const file of mdFiles) {
      copyFileSync(join(cwd, file), join(contentDir, file));
    }
    results.push(`Copied ${mdFiles.length} markdown file(s) to src/content/`);

    // Step 6: Build with Astro
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
        content: [{
          type: "text",
          text: `Build failed:\n${stderr}\n\nMake sure Astro is installed (run init first) and you have a valid Astro project setup.`,
        }],
        details: {},
      };
    }

    // Step 7: Deploy to Cloudflare Pages
    const distDir = resolve(cwd, "dist");
    if (!existsSync(distDir)) {
      return {
        content: [{
          type: "text",
          text: "Build output directory (dist/) not found. The Astro build may have failed silently.",
        }],
        details: {},
      };
    }

    // Step 7.1: Ensure Cloudflare Pages project exists, create if not
    results.push(`Checking Cloudflare Pages project "${config.cloudflare.projectName}"...`);
    try {
      const listResult = spawnSync(
        "npx", ["wrangler", "pages", "project", "list"],
        { cwd: process.cwd(), stdio: "pipe", timeout: 30000 }
      );
      const listOutput = listResult.stdout?.toString() || "";
      if (!listOutput.includes(config.cloudflare.projectName)) {
        results.push(`Project "${config.cloudflare.projectName}" not found, creating...`);
        const createResult = spawnSync(
          "npx",
          ["wrangler", "pages", "project", "create", config.cloudflare.projectName, "--production-branch", "main"],
          { cwd: process.cwd(), stdio: "pipe", timeout: 30000 }
        );
        if (createResult.status !== 0) {
          const createErr = createResult.stderr?.toString() || "";
          // "already exists" is fine
          if (!createErr.includes("already exists")) {
            return {
              content: [{
                type: "text",
                text: `Failed to create Cloudflare Pages project:\n${createErr}`,
              }],
              details: {},
            };
          }
        }
        results.push(`Project "${config.cloudflare.projectName}" created`);
      } else {
        results.push("Project exists");
      }
    } catch (err: any) {
      results.push(`Warning: could not verify project existence: ${err.message}`);
    }

    // Step 7.2: Deploy
    results.push("Deploying to Cloudflare Pages...");
    try {
      const output = execSync(
        `npx wrangler pages deploy dist --project-name ${config.cloudflare.projectName}`,
        {
          cwd: process.cwd(),
          stdio: "pipe",
        }
      );
      const deployOutput = output.toString();
      results.push("Deployment successful!");
      results.push(deployOutput);
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message;
      return {
        content: [{
          type: "text",
          text: `Deployment failed:\n${stderr}`,
        }],
        details: {},
      };
    }

    return {
      content: [{ type: "text", text: results.join("\n") }],
      details: {},
    };
  },
};
