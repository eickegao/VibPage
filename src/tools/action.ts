import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { homedir } from "os";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "fs";

export interface ActionParam {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface Action {
  name: string;
  description: string;
  url: string;
  parameters: ActionParam[];
  steps: string[];
  createdAt: string;
  updatedAt: string;
}

const ACTIONS_DIR = join(homedir(), ".vibpage", "Actions");

export function getActionsDir(): string {
  return ACTIONS_DIR;
}

function ensureActionsDir(): void {
  if (!existsSync(ACTIONS_DIR)) {
    mkdirSync(ACTIONS_DIR, { recursive: true });
  }
}

function actionPath(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  return join(ACTIONS_DIR, `${safe}.md`);
}

// --- Markdown serialization ---

function actionToMarkdown(action: Action): string {
  let md = `---\n`;
  md += `name: ${action.name}\n`;
  md += `description: ${action.description}\n`;
  md += `url: ${action.url}\n`;
  md += `created: ${action.createdAt}\n`;
  md += `updated: ${action.updatedAt}\n`;
  if (action.parameters.length > 0) {
    md += `parameters:\n`;
    for (const p of action.parameters) {
      md += `  - name: ${p.name}\n`;
      md += `    description: ${p.description}\n`;
      md += `    required: ${p.required}\n`;
      if (p.default) {
        md += `    default: ${p.default}\n`;
      }
    }
  }
  md += `---\n\n`;
  md += `# ${action.name}\n\n`;
  md += `${action.description}\n\n`;
  if (action.parameters.length > 0) {
    md += `## Parameters\n\n`;
    for (const p of action.parameters) {
      const req = p.required ? "(required)" : "(optional)";
      const def = p.default ? ` [default: ${p.default}]` : "";
      md += `- **{${p.name}}** — ${p.description} ${req}${def}\n`;
    }
    md += `\n`;
  }
  md += `## Steps\n\n`;
  for (let i = 0; i < action.steps.length; i++) {
    md += `${i + 1}. ${action.steps[i]}\n`;
  }
  md += ``;
  return md;
}

function parseMarkdownAction(content: string): Action | null {
  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];
  const getValue = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : "";
  };

  // Parse parameters from frontmatter
  const parameters: ActionParam[] = [];
  const paramSection = fm.match(/parameters:\n((?:\s{2}- [\s\S]*?)(?=\n\w|\n---|$))/);
  if (paramSection) {
    const paramBlocks = paramSection[1].split(/\n\s{2}- /).filter(Boolean);
    for (const block of paramBlocks) {
      const lines = block.startsWith("- ") ? block.slice(2) : block;
      const pName = lines.match(/name:\s*(.+)/)?.[1]?.trim() || "";
      const pDesc = lines.match(/description:\s*(.+)/)?.[1]?.trim() || "";
      const pReq = lines.match(/required:\s*(.+)/)?.[1]?.trim() === "true";
      const pDef = lines.match(/default:\s*(.+)/)?.[1]?.trim();
      if (pName) {
        parameters.push({ name: pName, description: pDesc, required: pReq, default: pDef });
      }
    }
  }

  // Parse steps from body
  const body = content.slice(fmMatch[0].length);
  const stepsMatch = body.match(/## Steps\n\n([\s\S]*?)$/);
  const steps: string[] = [];
  if (stepsMatch) {
    const lines = stepsMatch[1].trim().split("\n");
    for (const line of lines) {
      const stepMatch = line.match(/^\d+\.\s+(.+)/);
      if (stepMatch) {
        steps.push(stepMatch[1]);
      }
    }
  }

  return {
    name: getValue("name"),
    description: getValue("description"),
    url: getValue("url"),
    parameters,
    steps,
    createdAt: getValue("created") || new Date().toISOString(),
    updatedAt: getValue("updated") || new Date().toISOString(),
  };
}

// --- CRUD ---

export function loadAction(name: string): Action | null {
  // Try exact path first
  let path = actionPath(name);
  if (!existsSync(path)) {
    // Try finding by scanning all files
    ensureActionsDir();
    const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(ACTIONS_DIR, f), "utf-8");
      const action = parseMarkdownAction(content);
      if (action && action.name.toLowerCase() === name.toLowerCase()) {
        return action;
      }
    }
    return null;
  }
  const content = readFileSync(path, "utf-8");
  return parseMarkdownAction(content);
}

export function listActions(): Action[] {
  ensureActionsDir();
  const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".md"));
  const actions: Action[] = [];
  for (const f of files) {
    const content = readFileSync(join(ACTIONS_DIR, f), "utf-8");
    const action = parseMarkdownAction(content);
    if (action) actions.push(action);
  }
  return actions;
}

export function saveAction(action: Action): string {
  ensureActionsDir();
  const path = actionPath(action.name);
  writeFileSync(path, actionToMarkdown(action));
  return path;
}

export function deleteAction(name: string): boolean {
  const path = actionPath(name);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

// --- Agent Tools ---

const actionSaveParams = Type.Object({
  name: Type.String({ description: "Action name (e.g. 'post-to-x', 'download-report')" }),
  description: Type.String({ description: "What this action does" }),
  url: Type.String({ description: "Target URL to open" }),
  parameters: Type.Array(
    Type.Object({
      name: Type.String({ description: "Parameter name" }),
      description: Type.String({ description: "Parameter description" }),
      required: Type.Boolean({ description: "Whether this parameter is required" }),
      default: Type.Optional(Type.String({ description: "Default value" })),
    }),
    { description: "Parameters that can be customized when running this action" }
  ),
  steps: Type.Array(
    Type.String({ description: "Natural language instruction for this step" }),
    { description: "Step-by-step instructions for the AI to follow. Use {param_name} for variable parts." }
  ),
});

export const actionSaveTool: AgentTool<typeof actionSaveParams> = {
  name: "action_save",
  label: "Save Action",
  description:
    "Save a browser automation action as a reusable Markdown file in ~/.vibpage/Actions/. Actions can be shared by copying the .md file. Steps use {param} syntax for variable parts.",
  parameters: actionSaveParams,
  execute: async (_toolCallId, params) => {
    const now = new Date().toISOString();
    const existing = loadAction(params.name);
    const action: Action = {
      name: params.name,
      description: params.description,
      url: params.url,
      parameters: params.parameters,
      steps: params.steps,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const path = saveAction(action);
    return {
      content: [
        {
          type: "text",
          text: `Action "${params.name}" saved (${params.steps.length} steps).\nFile: ${path}\n\nShare this action by copying the .md file to another user's ~/.vibpage/Actions/ directory.`,
        },
      ],
      details: {},
    };
  },
};

const actionListParams = Type.Object({});

export const actionListTool: AgentTool<typeof actionListParams> = {
  name: "action_list",
  label: "List Actions",
  description: "List all saved actions from ~/.vibpage/Actions/.",
  parameters: actionListParams,
  execute: async () => {
    const actions = listActions();
    if (actions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No actions found.\nActions directory: ${ACTIONS_DIR}\n\nCreate one by describing a task, or copy .md files from others into the directory.`,
          },
        ],
        details: {},
      };
    }
    const list = actions
      .map((a) => {
        const params = a.parameters.length > 0
          ? ` [${a.parameters.map((p) => `{${p.name}}`).join(", ")}]`
          : "";
        return `- **${a.name}**${params} — ${a.description} (${a.steps.length} steps)`;
      })
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `${list}\n\nActions directory: ${ACTIONS_DIR}`,
        },
      ],
      details: {},
    };
  },
};

const actionDeleteParams = Type.Object({
  name: Type.String({ description: "Name of the action to delete" }),
});

export const actionDeleteTool: AgentTool<typeof actionDeleteParams> = {
  name: "action_delete",
  label: "Delete Action",
  description: "Delete a saved action.",
  parameters: actionDeleteParams,
  execute: async (_toolCallId, params) => {
    const deleted = deleteAction(params.name);
    return {
      content: [
        {
          type: "text",
          text: deleted
            ? `Action "${params.name}" deleted.`
            : `Action "${params.name}" not found.`,
        },
      ],
      details: {},
    };
  },
};

const actionRunParams = Type.Object({
  name: Type.String({ description: "Name of the action to run" }),
  params: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "Parameter values to use (key-value pairs)",
    })
  ),
});

export const actionRunTool: AgentTool<typeof actionRunParams> = {
  name: "action_run",
  label: "Run Action",
  description:
    "Run a saved action. Loads the action, substitutes parameters, and returns the step-by-step instructions for execution with browser_task.",
  parameters: actionRunParams,
  execute: async (_toolCallId, params) => {
    const action = loadAction(params.name);
    if (!action) {
      throw new Error(
        `Action "${params.name}" not found. Use action_list to see available actions.`
      );
    }

    const providedParams = params.params || {};
    for (const p of action.parameters) {
      if (p.required && !providedParams[p.name] && !p.default) {
        throw new Error(
          `Missing required parameter: ${p.name} (${p.description})`
        );
      }
    }

    const resolvedParams: Record<string, string> = {};
    for (const p of action.parameters) {
      resolvedParams[p.name] = providedParams[p.name] || p.default || "";
    }

    const stepsText = action.steps
      .map((step, i) => {
        let s = step;
        for (const [key, value] of Object.entries(resolvedParams)) {
          s = s.replace(new RegExp(`\\{${key}\\}`, "g"), value);
        }
        return `${i + 1}. ${s}`;
      })
      .join("\n");

    const taskDescription = `Execute action: "${action.name}"
Description: ${action.description}
URL: ${action.url}

Parameters:
${Object.entries(resolvedParams).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)"}

Steps:
${stepsText}

Now use browser_task to open ${action.url} and execute these steps one by one.`;

    return {
      content: [{ type: "text", text: taskDescription }],
      details: { action, resolvedParams },
    };
  },
};
