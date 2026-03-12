import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execSync } from "child_process";
import * as readline from "readline";

async function confirmExecution(command: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(`\n⚡ Execute: ${command}\n  Allow? (y/n) `, (answer) => {
      rl.close();
      resolve(
        answer.toLowerCase() === "y" || answer.toLowerCase() === "yes"
      );
    });
  });
}

const shellParams = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
});

export const shellExecuteTool: AgentTool<typeof shellParams> = {
  name: "shell_execute",
  label: "Shell Execute",
  description:
    "Execute a shell command and return its output. The user will be asked to confirm before execution.",
  parameters: shellParams,
  execute: async (_toolCallId, params) => {
    const allowed = await confirmExecution(params.command);
    if (!allowed) {
      return {
        content: [
          { type: "text", text: "Command execution denied by user." },
        ],
        details: {},
      };
    }
    try {
      const output = execSync(params.command, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: process.cwd(),
      });
      return {
        content: [{ type: "text", text: output || "(no output)" }],
        details: {},
      };
    } catch (err: any) {
      throw new Error(
        `Command failed (exit ${err.status}): ${err.stderr || err.message}`
      );
    }
  },
};
