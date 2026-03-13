#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config.js";
import { createAgent } from "./agent.js";
import { App } from "./ui.js";
import {
  type Language,
  projectConfigExists,
  loadProjectConfig,
  saveProjectConfig,
} from "./project-config.js";

// 5 gradient anchor colors (teal to light cyan)
const COLORS: [number, number, number][] = [
  [38, 170, 185],
  [65, 186, 199],
  [105, 203, 212],
  [151, 220, 226],
  [201, 237, 240],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function interpolateColor(t: number): [number, number, number] {
  // t is 0..1, map to 4 segments between 5 anchor colors
  const seg = t * (COLORS.length - 1);
  const i = Math.min(Math.floor(seg), COLORS.length - 2);
  const f = seg - i;
  return [
    lerp(COLORS[i][0], COLORS[i + 1][0], f),
    lerp(COLORS[i][1], COLORS[i + 1][1], f),
    lerp(COLORS[i][2], COLORS[i + 1][2], f),
  ];
}

function gradientLine(line: string): string {
  // Find first and last non-space character positions for even distribution
  const totalLen = line.length;
  let result = "";
  for (let i = 0; i < totalLen; i++) {
    const ch = line[i];
    if (ch === " ") {
      result += ch;
    } else {
      const t = totalLen > 1 ? i / (totalLen - 1) : 0;
      const [r, g, b] = interpolateColor(t);
      result += chalk.rgb(r, g, b).bold(ch);
    }
  }
  return result;
}

// Large ASCII art using block characters
const BANNER_LINES = [
  " ██╗   ██╗ ██╗ ██████╗  ██████╗   █████╗   ██████╗  ███████╗",
  " ██║   ██║ ██║ ██╔══██╗ ██╔══██╗ ██╔══██╗ ██╔════╝  ██╔════╝",
  " ██║   ██║ ██║ ██████╔╝ ██████╔╝ ███████║ ██║  ███╗ █████╗  ",
  " ╚██╗ ██╔╝ ██║ ██╔══██╗ ██╔═══╝  ██╔══██║ ██║   ██║ ██╔══╝  ",
  "  ╚████╔╝  ██║ ██████╔╝ ██║      ██║  ██║ ╚██████╔╝ ███████╗",
  "   ╚═══╝   ╚═╝ ╚═════╝  ╚═╝      ╚═╝  ╚═╝  ╚═════╝  ╚══════╝",
];

const WELCOME_TEXTS: Record<Language, { subtitle: string; tips: string[]; quit: string }> = {
  "zh-CN": {
    subtitle: "AI 驱动的内容创作",
    tips: ["让我帮你写文章、博客或任何内容。", "我可以搜索网页并获取资料。", "我可以对网页截图。"],
    quit: '输入 "exit" 退出。',
  },
  "zh-TW": {
    subtitle: "AI 驅動的內容創作",
    tips: ["讓我幫你寫文章、部落格或任何內容。", "我可以搜尋網頁並取得資料。", "我可以對網頁截圖。"],
    quit: '輸入 "exit" 退出。',
  },
  en: {
    subtitle: "AI-powered content creation",
    tips: ["Ask me to write articles, blog posts, or any content.", "I can search the web and fetch pages for research.", "I can take screenshots of web pages."],
    quit: 'Type "exit" to quit.',
  },
  fr: {
    subtitle: "Création de contenu par IA",
    tips: ["Demandez-moi d'écrire des articles ou tout autre contenu.", "Je peux rechercher sur le web.", "Je peux capturer des pages web."],
    quit: 'Tapez "exit" pour quitter.',
  },
  de: {
    subtitle: "KI-gestützte Inhaltserstellung",
    tips: ["Lass mich Artikel, Blogbeiträge oder andere Inhalte schreiben.", "Ich kann im Web suchen und Seiten abrufen.", "Ich kann Screenshots von Webseiten machen."],
    quit: '"exit" eingeben zum Beenden.',
  },
  es: {
    subtitle: "Creación de contenido con IA",
    tips: ["Pídeme escribir artículos, blogs o cualquier contenido.", "Puedo buscar en la web.", "Puedo tomar capturas de páginas web."],
    quit: 'Escribe "exit" para salir.',
  },
  pt: {
    subtitle: "Criação de conteúdo com IA",
    tips: ["Peça-me para escrever artigos, blogs ou qualquer conteúdo.", "Posso pesquisar na web.", "Posso fazer capturas de páginas web."],
    quit: 'Digite "exit" para sair.',
  },
  ko: {
    subtitle: "AI 기반 콘텐츠 제작",
    tips: ["기사, 블로그 또는 모든 콘텐츠를 작성해 드립니다.", "웹을 검색하고 자료를 가져올 수 있습니다.", "웹 페이지의 스크린샷을 찍을 수 있습니다."],
    quit: '"exit"를 입력하면 종료됩니다.',
  },
};

function showWelcome(provider: string, model: string, language: Language) {
  process.stdout.write("\x1B[2J\x1B[H");
  const t = WELCOME_TEXTS[language] || WELCOME_TEXTS.en;

  console.log("");
  for (const line of BANNER_LINES) {
    console.log(gradientLine(line));
  }
  console.log("");
  console.log(chalk.rgb(151, 220, 226)(`  ${t.subtitle}\n`));
  t.tips.forEach((tip, i) => {
    console.log(chalk.white(`  ${i + 1}. ${tip}`));
  });
  console.log(chalk.white(`  ${t.tips.length + 1}. ${t.quit}\n`));
  console.log(chalk.rgb(105, 203, 212)(`  Using: ${provider}/${model}\n`));
}

program
  .name("vibpage")
  .description("AI-powered content creation CLI")
  .version("0.1.0")
  .option("-m, --model <model>", "AI model to use")
  .option("-p, --provider <provider>", "AI provider (anthropic/openai/google)")
  .option("-o, --output <dir>", "Output directory")
  .action(async (options) => {
    const config = loadConfig();

    if (options.provider) config.provider = options.provider;
    if (options.model) config.model = options.model;
    if (options.output) config.outputDir = options.output;

    // Auto init: ensure config exists
    if (!projectConfigExists()) {
      saveProjectConfig(loadProjectConfig());
    }
    const projectConfig = loadProjectConfig();

    showWelcome(config.provider, config.model, projectConfig.language);

    const agent = createAgent(config, projectConfig.language);

    render(
      <App agent={agent} config={{ provider: config.provider, model: config.model }} />
    );
  });

program.parse();
