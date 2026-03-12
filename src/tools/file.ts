import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, relative } from "path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

function isWithinWorkDir(filePath: string): boolean {
  const abs = resolve(filePath);
  const cwd = process.cwd();
  return abs.startsWith(cwd);
}

const readFileParams = Type.Object({
  path: Type.String({ description: "File path to read" }),
});

export const readFileTool: AgentTool<typeof readFileParams> = {
  name: "read_file",
  label: "Read File",
  description:
    "Read the contents of a file. Paths are relative to the current working directory.",
  parameters: readFileParams,
  execute: async (_toolCallId, params) => {
    const filePath = resolve(params.path);
    if (!isWithinWorkDir(filePath)) {
      throw new Error(
        `Access denied: ${params.path} is outside the working directory`
      );
    }
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${params.path}`);
    }
    const content = readFileSync(filePath, "utf-8");
    return {
      content: [{ type: "text", text: content }],
      details: {},
    };
  },
};

const writeFileParams = Type.Object({
  path: Type.String({ description: "File path to write to" }),
  content: Type.String({ description: "Content to write" }),
});

export const writeFileTool: AgentTool<typeof writeFileParams> = {
  name: "write_file",
  label: "Write File",
  description:
    "Write content to a file. Creates the file if it does not exist. Paths are relative to the current working directory.",
  parameters: writeFileParams,
  execute: async (_toolCallId, params) => {
    const filePath = resolve(params.path);
    if (!isWithinWorkDir(filePath)) {
      throw new Error(
        `Access denied: ${params.path} is outside the working directory`
      );
    }
    writeFileSync(filePath, params.content, "utf-8");
    return {
      content: [
        {
          type: "text",
          text: `File written: ${relative(process.cwd(), filePath)}`,
        },
      ],
      details: {},
    };
  },
};
