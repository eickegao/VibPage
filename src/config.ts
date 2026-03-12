import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface VibPageConfig {
  provider: "anthropic" | "openai" | "google";
  model: string;
  apiKey: string;
  outputDir: string;
}

const DEFAULT_CONFIG: VibPageConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  apiKey: "",
  outputDir: ".",
};

const CONFIG_DIR = join(homedir(), ".vibpage");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function loadConfig(): VibPageConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: VibPageConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600);
}

export function getApiKey(config: VibPageConfig): string {
  const envKeys: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
  };
  return process.env[envKeys[config.provider]] || config.apiKey;
}
