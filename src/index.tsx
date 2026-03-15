#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
import React from "react";
import { render } from "ink";
import { loadConfig, isProxyMode } from "./config.js";
import { createAgent } from "./agent.js";
import { App } from "./ui.js";
import {
  type Language,
  projectConfigExists,
  loadProjectConfig,
  saveProjectConfig,
} from "./project-config.js";
import readline from "readline";

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

const LOGIN_TEXTS: Record<Language, { welcome: string; requireLogin: string; signInNow: string; loginFailed: string; continueWithout: string; openingBrowser: string }> = {
  "zh-CN": {
    welcome: "欢迎使用 VibPage！",
    requireLogin: "使用 VibPage 需要登录账户。登录后即可使用 AI 自动化浏览器操作。",
    signInNow: "是否现在登录？(Y/n) ",
    loginFailed: "登录失败：",
    continueWithout: "跳过登录。部分功能将不可用。",
    openingBrowser: "正在打开浏览器进行登录...",
  },
  "zh-TW": {
    welcome: "歡迎使用 VibPage！",
    requireLogin: "使用 VibPage 需要登入帳戶。登入後即可使用 AI 自動化瀏覽器操作。",
    signInNow: "是否現在登入？(Y/n) ",
    loginFailed: "登入失敗：",
    continueWithout: "跳過登入。部分功能將不可用。",
    openingBrowser: "正在開啟瀏覽器進行登入...",
  },
  en: {
    welcome: "Welcome to VibPage!",
    requireLogin: "Sign in to your account to get started. Once logged in, you can automate any browser task with AI.",
    signInNow: "Sign in now? (Y/n) ",
    loginFailed: "Login failed: ",
    continueWithout: "Skipped login. Some features will be unavailable.",
    openingBrowser: "Opening browser for sign-in...",
  },
  fr: {
    welcome: "Bienvenue sur VibPage !",
    requireLogin: "Connectez-vous pour commencer. Une fois connecté, vous pourrez automatiser toute tâche navigateur avec l'IA.",
    signInNow: "Se connecter maintenant ? (O/n) ",
    loginFailed: "Échec de la connexion : ",
    continueWithout: "Connexion ignorée. Certaines fonctionnalités seront indisponibles.",
    openingBrowser: "Ouverture du navigateur pour la connexion...",
  },
  de: {
    welcome: "Willkommen bei VibPage!",
    requireLogin: "Melden Sie sich an, um loszulegen. Nach der Anmeldung können Sie jede Browser-Aufgabe mit KI automatisieren.",
    signInNow: "Jetzt anmelden? (J/n) ",
    loginFailed: "Anmeldung fehlgeschlagen: ",
    continueWithout: "Anmeldung übersprungen. Einige Funktionen sind nicht verfügbar.",
    openingBrowser: "Browser wird zur Anmeldung geöffnet...",
  },
  es: {
    welcome: "¡Bienvenido a VibPage!",
    requireLogin: "Inicia sesión para comenzar. Una vez conectado, podrás automatizar cualquier tarea del navegador con IA.",
    signInNow: "¿Iniciar sesión ahora? (S/n) ",
    loginFailed: "Error de inicio de sesión: ",
    continueWithout: "Inicio de sesión omitido. Algunas funciones no estarán disponibles.",
    openingBrowser: "Abriendo navegador para iniciar sesión...",
  },
  pt: {
    welcome: "Bem-vindo ao VibPage!",
    requireLogin: "Faça login para começar. Após o login, você poderá automatizar qualquer tarefa do navegador com IA.",
    signInNow: "Entrar agora? (S/n) ",
    loginFailed: "Falha no login: ",
    continueWithout: "Login ignorado. Alguns recursos estarão indisponíveis.",
    openingBrowser: "Abrindo navegador para login...",
  },
  ko: {
    welcome: "VibPage에 오신 것을 환영합니다!",
    requireLogin: "시작하려면 로그인하세요. 로그인 후 AI로 모든 브라우저 작업을 자동화할 수 있습니다.",
    signInNow: "지금 로그인하시겠습니까? (Y/n) ",
    loginFailed: "로그인 실패: ",
    continueWithout: "로그인을 건너뛰었습니다. 일부 기능을 사용할 수 없습니다.",
    openingBrowser: "로그인을 위해 브라우저를 여는 중...",
  },
  ja: {
    welcome: "VibPageへようこそ！",
    requireLogin: "サインインして始めましょう。ログイン後、AIであらゆるブラウザタスクを自動化できます。",
    signInNow: "今すぐサインインしますか？(Y/n) ",
    loginFailed: "ログイン失敗：",
    continueWithout: "ログインをスキップしました。一部の機能が利用できません。",
    openingBrowser: "サインインのためブラウザを開いています...",
  },
};

const WELCOME_TEXTS: Record<Language, { subtitle: string; tips: string[]; quit: string }> = {
  "zh-CN": {
    subtitle: "AI 驱动的 RPA 自动化",
    tips: ["用自然语言描述任务，AI 自动操作浏览器。", "支持任意网站：填表、发帖、下载报告等。", "创建 Action 保存常用流程，一键复用。"],
    quit: '输入 "exit" 退出。',
  },
  "zh-TW": {
    subtitle: "AI 驅動的 RPA 自動化",
    tips: ["用自然語言描述任務，AI 自動操作瀏覽器。", "支援任意網站：填表、發帖、下載報告等。", "建立 Action 保存常用流程，一鍵複用。"],
    quit: '輸入 "exit" 退出。',
  },
  en: {
    subtitle: "AI-powered RPA automation",
    tips: ["Describe tasks in natural language, AI operates the browser for you.", "Works on any website: forms, posts, reports, etc.", "Create Actions to save and reuse workflows."],
    quit: 'Type "exit" to quit.',
  },
  fr: {
    subtitle: "Automatisation RPA par IA",
    tips: ["Décrivez vos tâches, l'IA pilote le navigateur pour vous.", "Tout site web : formulaires, publications, rapports, etc.", "Créez des Actions pour sauvegarder et réutiliser vos workflows."],
    quit: 'Tapez "exit" pour quitter.',
  },
  de: {
    subtitle: "KI-gestützte RPA-Automatisierung",
    tips: ["Beschreiben Sie Aufgaben, KI steuert den Browser für Sie.", "Jede Website: Formulare, Posts, Berichte usw.", "Erstellen Sie Actions um Workflows zu speichern und wiederzuverwenden."],
    quit: '"exit" eingeben zum Beenden.',
  },
  es: {
    subtitle: "Automatización RPA con IA",
    tips: ["Describe tareas, la IA opera el navegador por ti.", "Cualquier sitio web: formularios, publicaciones, informes, etc.", "Crea Actions para guardar y reutilizar flujos de trabajo."],
    quit: 'Escribe "exit" para salir.',
  },
  pt: {
    subtitle: "Automação RPA com IA",
    tips: ["Descreva tarefas, a IA opera o navegador por você.", "Qualquer site: formulários, postagens, relatórios, etc.", "Crie Actions para salvar e reutilizar fluxos de trabalho."],
    quit: 'Digite "exit" para sair.',
  },
  ko: {
    subtitle: "AI 기반 RPA 자동화",
    tips: ["자연어로 작업을 설명하면 AI가 브라우저를 조작합니다.", "모든 웹사이트에서 작동: 양식 작성, 게시, 보고서 다운로드 등.", "Action을 만들어 자주 사용하는 워크플로를 저장하고 재사용하세요."],
    quit: '"exit"를 입력하면 종료됩니다.',
  },
  ja: {
    subtitle: "AI搭載RPA自動化",
    tips: ["自然言語でタスクを記述すると、AIがブラウザを操作します。", "あらゆるサイトに対応：フォーム入力、投稿、レポートDLなど。", "Actionを作成してワークフローを保存・再利用できます。"],
    quit: '"exit" と入力して終了します。',
  },
};

function showBanner(language: Language) {
  process.stdout.write("\x1B[2J\x1B[H");
  const t = WELCOME_TEXTS[language] || WELCOME_TEXTS.en;

  console.log("");
  for (const line of BANNER_LINES) {
    console.log(gradientLine(line));
  }
  console.log("");
  console.log(chalk.rgb(151, 220, 226)(`  ${t.subtitle}`) + chalk.dim(`  v${pkg.version}\n`));
}

function showTips(language: Language, provider: string, model: string) {
  const t = WELCOME_TEXTS[language] || WELCOME_TEXTS.en;
  t.tips.forEach((tip, i) => {
    console.log(chalk.white(`  ${i + 1}. ${tip}`));
  });
  console.log(chalk.white(`  ${t.tips.length + 1}. ${t.quit}\n`));
  console.log(chalk.rgb(105, 203, 212)(`  Using: ${provider}/${model}\n`));
}

function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y"));
    });
  });
}

program
  .name("vibpage")
  .description("AI-powered browser automation (RPA) CLI")
  .version(pkg.version)
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

    // Show banner first
    showBanner(projectConfig.language);

    // Check login status — if not logged in, prompt user
    if (!isProxyMode(config)) {
      const lt = LOGIN_TEXTS[projectConfig.language] || LOGIN_TEXTS.en;
      console.log(chalk.rgb(151, 220, 226)(`  ${lt.welcome}\n`));
      console.log(chalk.white(`  ${lt.requireLogin}\n`));
      const wantLogin = await askYesNo(chalk.white(`  ${lt.signInNow}`));
      if (wantLogin) {
        console.log(chalk.dim(`\n  ${lt.openingBrowser}\n`));
        const { login } = await import("./login.js");
        try {
          await login();
          Object.assign(config, loadConfig());
        } catch (err: any) {
          console.error(chalk.red(`\n  ${lt.loginFailed}${err.message}\n`));
        }
      }

      if (!isProxyMode(config)) {
        console.log(chalk.dim(`\n  ${lt.continueWithout}\n`));
      }
    }

    showTips(projectConfig.language, config.provider, config.model);

    const agent = createAgent(config, projectConfig.language);

    render(
      <App agent={agent} config={{ provider: config.provider, model: config.model }} />
    );
  });

program.parse();
