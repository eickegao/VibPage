import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, Static, useApp, useStdout, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { Agent } from "@mariozechner/pi-agent-core";
import {
  type Language,
  LANGUAGE_LABELS,
  loadProjectConfig,
  saveProjectConfig,
} from "./project-config.js";
import { buildSystemPrompt } from "./agent.js";
import { closeBrowser, openBrowser } from "./tools/push-social.js";

interface Message {
  id: number;
  role: "user" | "assistant" | "tool" | "status";
  text: string;
}

interface AppProps {
  agent: Agent;
  config: { provider: string; model: string };
}

let messageId = 0;
function nextId() {
  return ++messageId;
}

const TOOL_ICONS = {
  start: "◦",
  success: "✓",
  error: "✗",
} as const;

interface SlashCommand {
  name: string;
  description: Record<Language, string>;
  prompt: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/publish",
    description: {
      "zh-CN": "构建并部署网站到 Cloudflare Pages",
      "zh-TW": "建置並部署網站到 Cloudflare Pages",
      en: "Build and deploy site to Cloudflare Pages",
      fr: "Construire et déployer sur Cloudflare Pages",
      de: "Website erstellen und auf Cloudflare Pages bereitstellen",
      es: "Construir y desplegar en Cloudflare Pages",
      pt: "Construir e implantar no Cloudflare Pages",
      ko: "Cloudflare Pages에 사이트 빌드 및 배포",
      ja: "Cloudflare Pages にサイトをビルド・デプロイ",
    },
    prompt: "Please publish my site to Cloudflare Pages using the publish tool.",
  },
  {
    name: "/push",
    description: {
      "zh-CN": "推送内容到社交媒体",
      "zh-TW": "推送內容到社群媒體",
      en: "Push content to social media",
      fr: "Publier du contenu sur les réseaux sociaux",
      de: "Inhalte in sozialen Medien veröffentlichen",
      es: "Publicar contenido en redes sociales",
      pt: "Publicar conteúdo nas redes sociais",
      ko: "소셜 미디어에 콘텐츠 게시",
      ja: "ソーシャルメディアにコンテンツを投稿",
    },
    prompt: "Please help me push content to social media. Ask me which platform (currently X/Twitter and LinkedIn are supported) and what content I want to post, then use the push_social tool.",
  },
  {
    name: "/init",
    description: {
      "zh-CN": "初始化 VibPage 项目",
      "zh-TW": "初始化 VibPage 專案",
      en: "Initialize VibPage project",
      fr: "Initialiser le projet VibPage",
      de: "VibPage-Projekt initialisieren",
      es: "Inicializar proyecto VibPage",
      pt: "Inicializar projeto VibPage",
      ko: "VibPage 프로젝트 초기화",
      ja: "VibPage プロジェクトを初期化",
    },
    prompt: "Please initialize this VibPage project using the init tool.",
  },
  {
    name: "/status",
    description: {
      "zh-CN": "显示项目状态",
      "zh-TW": "顯示專案狀態",
      en: "Show project status",
      fr: "Afficher l'état du projet",
      de: "Projektstatus anzeigen",
      es: "Mostrar estado del proyecto",
      pt: "Mostrar status do projeto",
      ko: "프로젝트 상태 표시",
      ja: "プロジェクトの状態を表示",
    },
    prompt: "Please check the current project status: is it initialized? Are Astro and Wrangler installed? Is Cloudflare configured? Show me a summary.",
  },
  {
    name: "/language",
    description: {
      "zh-CN": "设置语言",
      "zh-TW": "設定語言",
      en: "Set response language",
      fr: "Définir la langue",
      de: "Sprache einstellen",
      es: "Establecer idioma",
      pt: "Definir idioma",
      ko: "언어 설정",
      ja: "言語を設定",
    },
    prompt: "",
  },
  {
    name: "/open-browser",
    description: {
      "zh-CN": "打开浏览器",
      "zh-TW": "開啟瀏覽器",
      en: "Open browser (for login or browsing)",
      fr: "Ouvrir le navigateur",
      de: "Browser öffnen",
      es: "Abrir navegador",
      pt: "Abrir navegador",
      ko: "브라우저 열기",
      ja: "ブラウザを開く",
    },
    prompt: "",
  },
  {
    name: "/close-browser",
    description: {
      "zh-CN": "关闭浏览器",
      "zh-TW": "關閉瀏覽器",
      en: "Close the browser",
      fr: "Fermer le navigateur",
      de: "Browser schließen",
      es: "Cerrar navegador",
      pt: "Fechar navegador",
      ko: "브라우저 닫기",
      ja: "ブラウザを閉じる",
    },
    prompt: "",
  },
  {
    name: "/help",
    description: {
      "zh-CN": "显示所有命令",
      "zh-TW": "顯示所有命令",
      en: "Show available commands",
      fr: "Afficher les commandes",
      de: "Verfügbare Befehle anzeigen",
      es: "Mostrar comandos disponibles",
      pt: "Mostrar comandos disponíveis",
      ko: "사용 가능한 명령어 표시",
      ja: "利用可能なコマンドを表示",
    },
    prompt: "",
  },
  {
    name: "/exit",
    description: {
      "zh-CN": "退出 VibPage",
      "zh-TW": "退出 VibPage",
      en: "Quit VibPage",
      fr: "Quitter VibPage",
      de: "VibPage beenden",
      es: "Salir de VibPage",
      pt: "Sair do VibPage",
      ko: "VibPage 종료",
      ja: "VibPage を終了",
    },
    prompt: "",
  },
];

const LANGUAGE_OPTIONS: { code: Language; label: string }[] = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "ko", label: "한국어" },
  { code: "ja", label: "日本語" },
];

type UIMode = "normal" | "command-select" | "language-select";

function MessageItem({ msg }: { msg: Message }) {
  switch (msg.role) {
    case "user":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color="#26AAB9" bold>{"  ● "}</Text>
            <Text>{msg.text}</Text>
          </Text>
        </Box>
      );
    case "assistant": {
      const lines = msg.text.split("\n");
      return (
        <Box flexDirection="column" marginTop={1}>
          {lines.map((line, i) => (
            <Text key={i}>
              {i === 0 ? (
                <Text color="green" bold>{"  ● "}</Text>
              ) : (
                <Text>{"     "}</Text>
              )}
              <Text>{line}</Text>
            </Text>
          ))}
        </Box>
      );
    }
    case "tool":
      return (
        <Text dimColor>{"  ⎿ "}{msg.text}</Text>
      );
    case "status":
      return (
        <Text color="red">{"  ⚠ "}{msg.text}</Text>
      );
    default:
      return <Text>{msg.text}</Text>;
  }
}

function Separator({ width }: { width: number }) {
  const line = "─".repeat(Math.max(width - 2, 20));
  return (
    <Box>
      <Text dimColor>{" "}{line}</Text>
    </Box>
  );
}

export function App({ agent, config }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState("");
  const currentTextRef = useRef("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [currentLang, setCurrentLang] = useState<Language>(loadProjectConfig().language);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const termWidth = stdout?.columns || 80;

  const [mode, setMode] = useState<UIMode>("normal");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filtered commands for command-select mode
  const filteredCommands = input.startsWith("/")
    ? SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(input.toLowerCase()))
    : SLASH_COMMANDS;

  // Determine if we should show command selector
  const showCommandSelect = mode === "command-select" && !isLoading;
  const showLanguageSelect = mode === "language-select" && !isLoading;

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [input]);

  // Handle arrow keys and enter for selection modes
  useInput((ch, key) => {
    if (isLoading) return;

    if (showCommandSelect) {
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.escape) {
        setMode("normal");
        setInput("");
        return;
      }
      if (key.return) {
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          executeCommand(cmd);
        }
        return;
      }
    }

    if (showLanguageSelect) {
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, LANGUAGE_OPTIONS.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.escape) {
        setMode("normal");
        return;
      }
      if (key.return) {
        const option = LANGUAGE_OPTIONS[selectedIndex];
        if (option) {
          const projectConfig = loadProjectConfig();
          projectConfig.language = option.code;
          saveProjectConfig(projectConfig);
          agent.setSystemPrompt(buildSystemPrompt(option.code));
          setCurrentLang(option.code);
          setMode("normal");
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              text: `Language set to ${option.label}.`,
            },
          ]);
        }
        return;
      }
    }
  });

  // Watch input for slash trigger
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    if (value === "/" && mode === "normal") {
      setMode("command-select");
      setSelectedIndex(0);
    } else if (!value.startsWith("/") && mode === "command-select") {
      setMode("normal");
    }
  }, [mode]);

  useEffect(() => {
    if (isLoading) {
      setElapsedSec(0);
      timerRef.current = setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isLoading]);

  function formatElapsed(sec: number): string {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  }

  useEffect(() => {
    const unsubscribe = agent.subscribe((event) => {
      switch (event.type) {
        case "message_start":
          currentTextRef.current = "";
          setStreamingText("");
          break;
        case "message_update": {
          const msg = event.message;
          if ("content" in msg && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if ("type" in part && part.type === "text" && "text" in part) {
                currentTextRef.current = part.text as string;
                setStreamingText(currentTextRef.current);
              }
            }
          }
          break;
        }
        case "message_end": {
          const finalText = currentTextRef.current;
          if (finalText) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "assistant", text: finalText },
            ]);
          }
          setStreamingText("");
          currentTextRef.current = "";
          break;
        }
        case "tool_execution_start":
          setToolStatus(event.toolName);
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "tool",
              text: `${TOOL_ICONS.start} ${event.toolName}`,
            },
          ]);
          break;
        case "tool_execution_end":
          setToolStatus("");
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "tool",
              text: event.isError
                ? `${TOOL_ICONS.error} ${event.toolName} failed`
                : `${TOOL_ICONS.success} ${event.toolName}`,
            },
          ]);
          break;
      }
    });
    return unsubscribe;
  }, [agent]);

  const sendPrompt = useCallback(
    async (text: string) => {
      setIsLoading(true);
      try {
        await agent.prompt(text);
        await agent.waitForIdle();
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "status", text: err.message },
        ]);
      }
      setIsLoading(false);
    },
    [agent]
  );

  const executeCommand = useCallback(
    async (cmd: SlashCommand) => {
      setInput("");
      setMode("normal");

      // /exit
      if (cmd.name === "/exit") {
        exit();
        return;
      }

      // /language — switch to language select
      if (cmd.name === "/language") {
        const currentLang = loadProjectConfig().language;
        const currentIdx = LANGUAGE_OPTIONS.findIndex((o) => o.code === currentLang);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: cmd.name },
        ]);
        setSelectedIndex(currentIdx >= 0 ? currentIdx : 0);
        setMode("language-select");
        return;
      }

      // /open-browser
      if (cmd.name === "/open-browser") {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: cmd.name },
        ]);
        const ok = await openBrowser("https://x.com");
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: ok ? "Browser opened." : "Failed to open browser. Run: npx playwright install chromium",
          },
        ]);
        return;
      }

      // /close-browser
      if (cmd.name === "/close-browser") {
        const closed = await closeBrowser();
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: cmd.name },
          {
            id: nextId(),
            role: "assistant",
            text: closed ? "Browser closed." : "No browser is open.",
          },
        ]);
        return;
      }

      // /help
      if (cmd.name === "/help") {
        const helpText = SLASH_COMMANDS.map(
          (c) => `${c.name}  ${c.description[currentLang] || c.description.en}`
        ).join("\n");
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: cmd.name },
          { id: nextId(), role: "assistant", text: helpText },
        ]);
        return;
      }

      // Commands with prompts
      if (cmd.prompt) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: cmd.name },
        ]);
        await sendPrompt(cmd.prompt);
      }
    },
    [exit, sendPrompt, agent]
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      // If in command-select mode, enter is handled by useInput
      if (mode === "command-select" || mode === "language-select") return;

      setInput("");

      if (trimmed === "exit" || trimmed === "quit") {
        exit();
        return;
      }

      // Check if it's a slash command typed manually
      const cmd = SLASH_COMMANDS.find((c) => c.name === trimmed);
      if (cmd) {
        await executeCommand(cmd);
        return;
      }

      // Regular message
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed },
      ]);
      await sendPrompt(trimmed);
    },
    [agent, exit, sendPrompt, executeCommand, mode]
  );

  return (
    <Box flexDirection="column">
      {/* Message history */}
      <Static items={messages}>
        {(msg) => (
          <MessageItem key={msg.id} msg={msg} />
        )}
      </Static>

      {/* Streaming text */}
      {streamingText && (
        <Box flexDirection="column" marginTop={1}>
          {streamingText.split("\n").map((line, i) => (
            <Text key={i}>
              {i === 0 ? (
                <Text color="green" bold>{"  ● "}</Text>
              ) : (
                <Text>{"     "}</Text>
              )}
              <Text>{line}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Loading spinner */}
      {isLoading && (
        <Box>
          <Text>{"  "}</Text>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text color="yellow" bold>
            {" "}
            {toolStatus ? `${toolStatus}` : "Thinking"}
          </Text>
          <Text dimColor>
            {"  "}{formatElapsed(elapsedSec)}
          </Text>
        </Box>
      )}

      {/* Input area */}
      <Separator width={termWidth} />
      <Box>
        <Text color={isLoading ? "gray" : "#97DCE2"} bold>
          {"  ❯ "}
        </Text>
        {mode === "language-select" ? (
          <Text dimColor>Select language with ↑↓, Enter to confirm, Esc to cancel</Text>
        ) : (
          <TextInput
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            placeholder={
              isLoading ? "waiting..." : "Type / for commands, or ask anything..."
            }
            focus={!isLoading && !showLanguageSelect}
          />
        )}
      </Box>
      <Separator width={termWidth} />

      {/* Command selector */}
      {showCommandSelect && filteredCommands.length > 0 && (
        <Box flexDirection="column">
          {filteredCommands.map((cmd, i) => (
            <Box key={cmd.name}>
              <Text>{"  "}</Text>
              {i === selectedIndex ? (
                <>
                  <Text color="#26AAB9" bold>{"❯ "}</Text>
                  <Text color="#26AAB9" bold>{cmd.name}</Text>
                  <Text color="#97DCE2">{"  "}{cmd.description[currentLang] || cmd.description.en}</Text>
                </>
              ) : (
                <>
                  <Text>{"  "}</Text>
                  <Text color="white">{cmd.name}</Text>
                  <Text color="gray">{"  "}{cmd.description[currentLang] || cmd.description.en}</Text>
                </>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Language selector */}
      {showLanguageSelect && (
        <Box flexDirection="column">
          {LANGUAGE_OPTIONS.map((opt, i) => (
            <Box key={opt.code}>
              <Text>{"  "}</Text>
              {i === selectedIndex ? (
                <>
                  <Text color="#26AAB9" bold>{"❯ "}</Text>
                  <Text color="#26AAB9" bold>{opt.label}</Text>
                </>
              ) : (
                <>
                  <Text>{"  "}</Text>
                  <Text color="white">{opt.label}</Text>
                </>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
