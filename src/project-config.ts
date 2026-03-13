import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { join } from "path";

export type Language = "zh-CN" | "zh-TW" | "en" | "fr" | "de" | "es" | "pt" | "ko";

export const LANGUAGE_LABELS: Record<Language, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "en": "English",
  "fr": "Français",
  "de": "Deutsch",
  "es": "Español",
  "pt": "Português",
  "ko": "한국어",
};

export interface ProjectConfig {
  language: Language;
  author: string;
  cloudflare: {
    projectName: string;
  };
  template: {
    source: string;
    repo: string;
  };
}

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  language: "zh-CN",
  author: "",
  cloudflare: {
    projectName: "",
  },
  template: {
    source: "github",
    repo: "",
  },
};

const CONFIG_FILENAME = ".vibpage.json";

function getConfigPath(): string {
  return join(process.cwd(), CONFIG_FILENAME);
}

export function projectConfigExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadProjectConfig(): ProjectConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return structuredClone(DEFAULT_PROJECT_CONFIG);
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  return {
    language: parsed.language || DEFAULT_PROJECT_CONFIG.language,
    author: parsed.author || DEFAULT_PROJECT_CONFIG.author,
    cloudflare: { ...DEFAULT_PROJECT_CONFIG.cloudflare, ...parsed.cloudflare },
    template: { ...DEFAULT_PROJECT_CONFIG.template, ...parsed.template },
  };
}

export function saveProjectConfig(config: ProjectConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  chmodSync(configPath, 0o600);
}
