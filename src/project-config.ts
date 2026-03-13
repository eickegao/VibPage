import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { join } from "path";

export interface ProjectConfig {
  cloudflare: {
    projectName: string;
  };
  template: {
    source: string;
    repo: string;
  };
}

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
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
    cloudflare: { ...DEFAULT_PROJECT_CONFIG.cloudflare, ...parsed.cloudflare },
    template: { ...DEFAULT_PROJECT_CONFIG.template, ...parsed.template },
  };
}

export function saveProjectConfig(config: ProjectConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  chmodSync(configPath, 0o600);
}
