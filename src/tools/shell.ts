import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execSync } from "child_process";

const shellParams = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
});

export const shellExecuteTool: AgentTool<typeof shellParams> = {
  name: "shell_execute",
  label: "Shell Execute",
  description:
    "Execute a shell command and return its output. Only use for safe, read-only or content-related commands. Never run destructive commands (rm -rf, format, etc).",
  parameters: shellParams,
  execute: async (_toolCallId, params) => {
    try {
      const output = execSync(params.command, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: process.cwd(),
      });
      return {
        content: [
          {
            type: "text",
            text: `$ ${params.command}\n${output || "(no output)"}`,
          },
        ],
        details: {},
      };
    } catch (err: any) {
      throw new Error(
        `Command failed (exit ${err.status}): ${err.stderr || err.message}`
      );
    }
  },
};
