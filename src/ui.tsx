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
import { closeBrowser, openBrowser } from "./tools/browser-task.js";
import { listActions, type Action } from "./tools/action.js";
import { loadConfig } from "./config.js";
import {
  startRemoteSession,
  stopRemoteSession,
  isRemoteActive,
  getActiveSession,
  generateQrCode,
  getRemoteTexts,
  type RemoteEvent,
} from "./remote.js";

interface Message {
  id: number;
  role: "user" | "assistant" | "tool" | "status" | "info";
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
    name: "/actions",
    description: {
      "zh-CN": "管理自动化 Actions",
      "zh-TW": "管理自動化 Actions",
      en: "Manage Actions",
      fr: "Gérer les Actions",
      de: "Actions verwalten",
      es: "Gestionar Actions",
      pt: "Gerenciar Actions",
      ko: "Actions 관리",
      ja: "Actions 管理",
    },
    prompt: "",
  },
  {
    name: "/run",
    description: {
      "zh-CN": "执行浏览器自动化任务",
      "zh-TW": "執行瀏覽器自動化任務",
      en: "Run a browser automation task",
      fr: "Exécuter une tâche d'automatisation navigateur",
      de: "Browser-Automatisierungsaufgabe ausführen",
      es: "Ejecutar tarea de automatización del navegador",
      pt: "Executar tarefa de automação do navegador",
      ko: "브라우저 자동화 작업 실행",
      ja: "ブラウザ自動化タスクを実行",
    },
    prompt: "Please help me run a browser automation task. Ask me which website URL I want to go to and what task I want to perform, then use the browser_task tool.",
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
    name: "/usage",
    description: {
      "zh-CN": "查看积分余额",
      "zh-TW": "查看積分餘額",
      en: "View credits balance",
      fr: "Voir le solde de crédits",
      de: "Guthaben anzeigen",
      es: "Ver saldo de créditos",
      pt: "Ver saldo de créditos",
      ko: "크레딧 잔액 보기",
      ja: "クレジット残高を表示",
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
    name: "/remote",
    description: {
      "zh-CN": "手机遥控 (扫码连接)",
      "zh-TW": "手機遙控 (掃碼連接)",
      en: "Phone remote (scan QR)",
      fr: "Télécommande (scanner QR)",
      de: "Handy-Fernsteuerung (QR scannen)",
      es: "Control remoto (escanear QR)",
      pt: "Controle remoto (escanear QR)",
      ko: "휴대폰 리모컨 (QR 스캔)",
      ja: "スマホリモコン (QRスキャン)",
    },
    prompt: "",
  },
  {
    name: "/logout",
    description: {
      "zh-CN": "登出并退出",
      "zh-TW": "登出並退出",
      en: "Sign out and quit",
      fr: "Se déconnecter et quitter",
      de: "Abmelden und beenden",
      es: "Cerrar sesión y salir",
      pt: "Sair da conta e encerrar",
      ko: "로그아웃 후 종료",
      ja: "サインアウトして終了",
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

// i18n labels for action menus
const ACTION_MENU_LABELS: Record<string, Record<Language, string>> = {
  create: {
    "zh-CN": "创建新 Actions",
    "zh-TW": "建立新 Actions",
    en: "Create new Actions",
    fr: "Créer de nouvelles Actions",
    de: "Neue Actions erstellen",
    es: "Crear nuevas Actions",
    pt: "Criar novas Actions",
    ko: "새 Actions 만들기",
    ja: "新しい Actions を作成",
  },
  listAll: {
    "zh-CN": "查看所有 Actions",
    "zh-TW": "檢視所有 Actions",
    en: "View all Actions",
    fr: "Voir toutes les Actions",
    de: "Alle Actions anzeigen",
    es: "Ver todas las Actions",
    pt: "Ver todas as Actions",
    ko: "모든 Actions 보기",
    ja: "すべての Actions を表示",
  },
  run: {
    "zh-CN": "运行",
    "zh-TW": "執行",
    en: "Run",
    fr: "Exécuter",
    de: "Ausführen",
    es: "Ejecutar",
    pt: "Executar",
    ko: "실행",
    ja: "実行",
  },
  edit: {
    "zh-CN": "编辑",
    "zh-TW": "編輯",
    en: "Edit",
    fr: "Modifier",
    de: "Bearbeiten",
    es: "Editar",
    pt: "Editar",
    ko: "편집",
    ja: "編集",
  },
  delete: {
    "zh-CN": "删除",
    "zh-TW": "刪除",
    en: "Delete",
    fr: "Supprimer",
    de: "Löschen",
    es: "Eliminar",
    pt: "Excluir",
    ko: "삭제",
    ja: "削除",
  },
  noActions: {
    "zh-CN": "暂无 Actions，请先创建。",
    "zh-TW": "尚無 Actions，請先建立。",
    en: "No Actions found. Create one first.",
    fr: "Aucune Action. Créez-en une d'abord.",
    de: "Keine Actions gefunden. Erstellen Sie zuerst eine.",
    es: "No hay Actions. Crea una primero.",
    pt: "Nenhuma Action encontrada. Crie uma primeiro.",
    ko: "Actions가 없습니다. 먼저 만들어 주세요.",
    ja: "Actions がありません。まず作成してください。",
  },
};

type UIMode =
  | "normal"
  | "command-select"
  | "language-select"
  | "action-select"    // top-level: create / view all
  | "action-list"      // list of saved actions
  | "action-detail"    // run / edit / delete for a selected action
  | "usage-display";   // show credits usage

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
    case "info": {
      const lines = msg.text.split("\n");
      return (
        <Box flexDirection="column" marginTop={1}>
          {lines.map((line, i) => (
            <Text key={i} color="#97DCE2">{i === 0 ? "  " : "  "}{line}</Text>
          ))}
        </Box>
      );
    }
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

function SelectMenu({ items, selectedIndex, currentLang }: {
  items: { label: string; desc?: string }[];
  selectedIndex: number;
  currentLang: Language;
}) {
  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Box key={i}>
          <Text>{"  "}</Text>
          {i === selectedIndex ? (
            <>
              <Text color="#26AAB9" bold>{"❯ "}</Text>
              <Text color="#26AAB9" bold>{item.label}</Text>
              {item.desc && <Text color="#97DCE2">{"  "}{item.desc}</Text>}
            </>
          ) : (
            <>
              <Text>{"  "}</Text>
              <Text color="white">{item.label}</Text>
              {item.desc && <Text color="gray">{"  "}{item.desc}</Text>}
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}

function UsageBar({ used, total, balance, width }: { used: number; total: number; balance: number; width: number }) {
  const pct = total > 0 ? Math.min(used / total, 1) : 0;
  const filledLen = Math.round(pct * width);
  const emptyLen = width - filledLen;
  const filled = "█".repeat(filledLen);
  const empty = "░".repeat(emptyLen);
  const pctStr = (pct * 100).toFixed(1);

  // Color based on usage: green < 50%, yellow 50-80%, red > 80%
  const barColor = pct > 0.8 ? "red" : pct > 0.5 ? "yellow" : "green";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={barColor}>{filled}</Text>
        <Text dimColor>{empty}</Text>
        <Text> {pctStr}%</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="white">Used:    </Text>
          <Text bold color="white">{used.toFixed(2)}</Text>
          <Text color="white"> credits</Text>
        </Text>
        <Text>
          <Text color="white">Balance: </Text>
          <Text bold color="green">{balance.toFixed(2)}</Text>
          <Text color="white"> credits</Text>
        </Text>
      </Box>
    </Box>
  );
}

export function App({ agent, config }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRemoteLocked, setIsRemoteLocked] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState("");
  const currentTextRef = useRef("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [currentLang, setCurrentLang] = useState<Language>(loadProjectConfig().language);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const termWidth = stdout?.columns || 80;

  const [mode, setMode] = useState<UIMode>("normal");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const modeRef = useRef<UIMode>(mode);
  const selectedIndexRef = useRef(0);
  modeRef.current = mode;
  selectedIndexRef.current = selectedIndex;

  // Action menu state
  const [actionsList, setActionsList] = useState<Action[]>([]);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);

  // Usage display state
  const [usageData, setUsageData] = useState<{ balance: number; totalCreditsUsed: number; initialBalance: number } | null>(null);

  // Menu breadcrumb path for chat history display
  const [menuPath, setMenuPath] = useState<string[]>([]);

  // Filtered commands for command-select mode
  const filteredCommands = input.startsWith("/")
    ? SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(input.toLowerCase()))
    : SLASH_COMMANDS;

  // Determine visible modes
  const isMenuMode = mode !== "normal" && !isLoading;
  // Sub-menu = any menu deeper than command-select (hides input box)
  const isSubMenu = isMenuMode && mode !== "command-select";

  // Menu item counts for each mode
  function getMenuLength(): number {
    switch (mode) {
      case "command-select": return filteredCommands.length;
      case "language-select": return LANGUAGE_OPTIONS.length;
      case "action-select": return 2; // create, view all
      case "action-list": return actionsList.length;
      case "action-detail": return 3; // run, edit, delete
      default: return 0;
    }
  }

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [input]);

  // Handle arrow keys and enter for selection modes
  useInput((ch, key) => {
    // Always allow Escape during loading or remote lock
    if (isLoading || isRemoteLocked) {
      if (key.escape) {
        if (isRemoteLocked) {
          stopRemoteSession();
          setIsRemoteLocked(false);
        } else {
          exit();
        }
      }
      return;
    }
    if (!isMenuMode) return;
    // In command-select mode, TextInput handles Enter via onSubmit
    if (mode === "command-select" && key.return) return;

    const menuLen = getMenuLength();

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(i + 1, menuLen - 1));
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (key.escape) {
      // Go back one level
      if (mode === "action-detail") {
        setSelectedAction(null);
        setSelectedIndex(0);
        setMenuPath((p) => p.slice(0, -1));
        setMode("action-list");
      } else if (mode === "action-list") {
        setSelectedIndex(0);
        setMenuPath((p) => p.slice(0, -1));
        setMode("action-select");
      } else if (mode === "action-select" || mode === "language-select") {
        setSelectedIndex(0);
        setMenuPath([]);
        setMode("normal");
        setInput("");
      } else if (mode === "usage-display") {
        setUsageData(null);
        setMenuPath([]);
        setMode("normal");
        setInput("");
      } else {
        setMenuPath([]);
        setMode("normal");
        setInput("");
      }
      return;
    }
    if (key.return) {
      handleMenuSelect();
      return;
    }
  });

  function buildPathMessage(extraSegments: string[] = []): string {
    return [...menuPath, ...extraSegments].join(" / ");
  }

  function handleMenuSelect() {
    switch (mode) {
      case "command-select": {
        const cmd = filteredCommands[selectedIndex];
        if (cmd) executeCommand(cmd);
        break;
      }
      case "language-select": {
        const option = LANGUAGE_OPTIONS[selectedIndex];
        if (option) {
          const projectConfig = loadProjectConfig();
          projectConfig.language = option.code;
          saveProjectConfig(projectConfig);
          agent.setSystemPrompt(buildSystemPrompt(option.code));
          setCurrentLang(option.code);
          const pathMsg = buildPathMessage([option.label]);
          setMenuPath([]);
          setMode("normal");
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "user", text: pathMsg },
            { id: nextId(), role: "assistant", text: `Language set to ${option.label}.` },
          ]);
        }
        break;
      }
      case "action-select": {
        if (selectedIndex === 0) {
          // Create new Actions
          const label = ACTION_MENU_LABELS.create[currentLang] || ACTION_MENU_LABELS.create.en;
          const pathMsg = buildPathMessage([label]);
          setMenuPath([]);
          setMode("normal");
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "user", text: pathMsg },
          ]);
          sendPrompt("I want to create a new automation action. Ask me what task I want to automate, which website URL it targets, and what steps are involved. Then save it with action_save.");
        } else {
          // View all Actions → load and show list
          const label = ACTION_MENU_LABELS.listAll[currentLang] || ACTION_MENU_LABELS.listAll.en;
          const actions = listActions();
          if (actions.length === 0) {
            const noMsg = ACTION_MENU_LABELS.noActions[currentLang] || ACTION_MENU_LABELS.noActions.en;
            const pathMsg = buildPathMessage([label]);
            setMenuPath([]);
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "user", text: pathMsg },
              { id: nextId(), role: "assistant", text: noMsg },
            ]);
            setMode("normal");
          } else {
            setMenuPath((p) => [...p, label]);
            setActionsList(actions);
            setSelectedIndex(0);
            setMode("action-list");
          }
        }
        break;
      }
      case "action-list": {
        const action = actionsList[selectedIndex];
        if (action) {
          setMenuPath((p) => [...p, action.name]);
          setSelectedAction(action);
          setSelectedIndex(0);
          setMode("action-detail");
        }
        break;
      }
      case "action-detail": {
        if (!selectedAction) break;
        const actionName = selectedAction.name;
        const labels = [
          ACTION_MENU_LABELS.run[currentLang] || ACTION_MENU_LABELS.run.en,
          ACTION_MENU_LABELS.edit[currentLang] || ACTION_MENU_LABELS.edit.en,
          ACTION_MENU_LABELS.delete[currentLang] || ACTION_MENU_LABELS.delete.en,
        ];
        const selectedLabel = labels[selectedIndex];
        const pathMsg = buildPathMessage([selectedLabel]);
        setMenuPath([]);
        setMode("normal");
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: pathMsg },
        ]);
        if (selectedIndex === 0) {
          sendPrompt(`Run the action "${actionName}" using action_run. If it needs parameters, ask me for them. Then execute it step by step with browser_task.`);
        } else if (selectedIndex === 1) {
          sendPrompt(`Load the action "${actionName}" using action_run (to see its current definition). Show me its current steps and parameters, then ask me what I want to change. After I confirm the changes, save it with action_save.`);
        } else {
          sendPrompt(`Delete the action "${actionName}" using action_delete. Confirm what was deleted.`);
        }
        setSelectedAction(null);
        break;
      }
    }
  }

  // Watch input for slash trigger
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    if (value.startsWith("/") && (mode === "normal" || mode === "command-select")) {
      const matches = SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(value.toLowerCase()));
      if (matches.length > 0) {
        setMode("command-select");
        setSelectedIndex(0);
      } else {
        setMode("normal");
      }
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
                const newText = part.text as string;
                const delta = newText.slice(currentTextRef.current.length);
                currentTextRef.current = newText;
                setStreamingText(currentTextRef.current);
                if (delta) {
                  const rs = getActiveSession();
                  if (rs) rs.send({ type: "message_delta", text: delta });
                }
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
            const rs = getActiveSession();
            if (rs) rs.send({ type: "message_end", text: finalText });
          }
          setStreamingText("");
          currentTextRef.current = "";
          break;
        }
        case "tool_execution_start": {
          setToolStatus(event.toolName);
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "tool",
              text: `${TOOL_ICONS.start} ${event.toolName}`,
            },
          ]);
          const rs = getActiveSession();
          if (rs) rs.send({ type: "tool", name: event.toolName, status: "running" });
          break;
        }
        case "tool_execution_end": {
          setToolStatus("");
          const success = !event.isError;
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "tool",
              text: success
                ? `${TOOL_ICONS.success} ${event.toolName}`
                : `${TOOL_ICONS.error} ${event.toolName} failed`,
            },
          ]);
          const rs = getActiveSession();
          if (rs) rs.send({ type: "tool", name: event.toolName, status: success ? "done" : "error" });
          break;
        }
      }
    });
    return unsubscribe;
  }, [agent]);

  const sendPrompt = useCallback(
    async (text: string) => {
      setIsLoading(true);
      {
        const rs = getActiveSession();
        if (rs) rs.send({ type: "busy" });
      }
      try {
        await agent.prompt(text);
        await agent.waitForIdle();
      } catch (err: any) {
        let errorMsg = err.message || String(err);
        // Check for insufficient balance / 402 error
        if (errorMsg.includes("402") || errorMsg.toLowerCase().includes("insufficient") || errorMsg.toLowerCase().includes("balance")) {
          const insufficientTexts: Record<string, string> = {
            "zh-CN": "积分不足，请充值后再试。访问 https://vibpage.com 管理您的订阅。",
            "zh-TW": "積分不足，請充值後再試。訪問 https://vibpage.com 管理您的訂閱。",
            en: "Insufficient credits. Please top up at https://vibpage.com to continue.",
            fr: "Crédits insuffisants. Rechargez sur https://vibpage.com pour continuer.",
            de: "Guthaben aufgebraucht. Laden Sie auf https://vibpage.com auf.",
            es: "Créditos insuficientes. Recarga en https://vibpage.com para continuar.",
            pt: "Créditos insuficientes. Recarregue em https://vibpage.com para continuar.",
            ko: "크레딧이 부족합니다. https://vibpage.com 에서 충전하세요.",
            ja: "クレジット不足です。https://vibpage.com で追加してください。",
          };
          errorMsg = insufficientTexts[currentLang] || insufficientTexts.en;
        }
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "status", text: errorMsg },
        ]);
      }
      setIsLoading(false);
      {
        const rs = getActiveSession();
        if (rs) rs.send({ type: "ready" });
      }
    },
    [agent]
  );

  const executeCommand = useCallback(
    async (cmd: SlashCommand) => {
      setInput("");
      setMode("normal");

      if (cmd.name === "/remote") {
        const texts = getRemoteTexts(currentLang);

        if (isRemoteActive()) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "info", text: texts.alreadyActive },
          ]);
          return;
        }

        const session = await startRemoteSession(currentLang, async (event: RemoteEvent) => {
          if (event.type === "connected" && event.from === "mobile") {
            setIsRemoteLocked(true);
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "info", text: texts.connected },
            ]);
          } else if (event.type === "disconnected") {
            setIsRemoteLocked(false);
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "info", text: texts.disconnected },
            ]);
          } else if (event.type === "prompt" && event.text) {
            const promptText = event.text.slice(0, 2000);
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "user", text: promptText },
            ]);
            await sendPrompt(promptText);
          } else if (event.type === "error") {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "status", text: event.message || texts.connectionLost },
            ]);
            setIsRemoteLocked(false);
          }
        });

        if (session) {
          const remoteUrl = `https://vibpage.com/remote?s=${session.sessionId}`;
          const qr = await generateQrCode(remoteUrl);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "info", text: `${texts.scanning}\n\n${qr}` },
          ]);
        }
        return;
      }

      if (cmd.name === "/logout") {
        const { loadConfig, saveConfig } = await import("./config.js");
        const cfg = loadConfig();
        cfg.vibpageApiKey = "";
        cfg.proxyUrl = "";
        saveConfig(cfg);
        exit();
        return;
      }

      if (cmd.name === "/exit") {
        exit();
        return;
      }

      if (cmd.name === "/actions") {
        setMenuPath([cmd.name]);
        setSelectedIndex(0);
        setMode("action-select");
        return;
      }

      if (cmd.name === "/language") {
        const lang = loadProjectConfig().language;
        const currentIdx = LANGUAGE_OPTIONS.findIndex((o) => o.code === lang);
        setMenuPath([cmd.name]);
        setSelectedIndex(currentIdx >= 0 ? currentIdx : 0);
        setMode("language-select");
        return;
      }

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

      if (cmd.name === "/usage") {
        // Fetch usage from Worker API
        const cfg = loadConfig();
        if (!cfg.proxyUrl || !cfg.vibpageApiKey) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "status", text: "Usage tracking requires proxy mode. Configure proxyUrl and vibpageApiKey in ~/.vibpage/config.json" },
          ]);
          return;
        }
        try {
          const res = await fetch(`${cfg.proxyUrl}/api/usage?days=30`, {
            headers: { Authorization: `Bearer ${cfg.vibpageApiKey}` },
          });
          if (!res.ok) throw new Error(`API error: ${res.status}`);
          const data = await res.json() as { balance: number; usage: { credits_consumed: number }[] };
          const totalUsed = (data.usage || []).reduce((sum: number, u: any) => sum + (u.credits_consumed || 0), 0);
          setUsageData({
            balance: data.balance,
            totalCreditsUsed: totalUsed,
            initialBalance: data.balance + totalUsed,
          });
          setMenuPath([cmd.name]);
          setMode("usage-display");
        } catch (err: any) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "status", text: err.message },
          ]);
        }
        return;
      }

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

      if (cmd.prompt) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: cmd.name },
        ]);
        await sendPrompt(cmd.prompt);
      }
    },
    [exit, sendPrompt, agent, currentLang]
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      // In command-select mode, Enter selects the highlighted command
      if (modeRef.current === "command-select") {
        const matches = SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(trimmed.toLowerCase()));
        const cmd = matches[selectedIndexRef.current];
        if (cmd) {
          setInput("");
          executeCommand(cmd);
        }
        return;
      }
      if (isMenuMode) return;

      setInput("");

      if (trimmed === "exit" || trimmed === "quit") {
        exit();
        return;
      }

      const cmd = SLASH_COMMANDS.find((c) => c.name === trimmed);
      if (cmd) {
        await executeCommand(cmd);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed },
      ]);
      await sendPrompt(trimmed);
    },
    [agent, exit, sendPrompt, executeCommand, isMenuMode]
  );

  // Build menu items for current mode
  function renderMenu() {
    if (!isMenuMode) return null;

    switch (mode) {
      case "command-select":
        if (filteredCommands.length === 0) return null;
        return (
          <SelectMenu
            items={filteredCommands.map((cmd) => ({
              label: cmd.name,
              desc: cmd.description[currentLang] || cmd.description.en,
            }))}
            selectedIndex={selectedIndex}
            currentLang={currentLang}
          />
        );

      case "language-select":
        return (
          <SelectMenu
            items={LANGUAGE_OPTIONS.map((opt) => ({ label: opt.label }))}
            selectedIndex={selectedIndex}
            currentLang={currentLang}
          />
        );

      case "action-select":
        return (
          <SelectMenu
            items={[
              { label: ACTION_MENU_LABELS.create[currentLang] || ACTION_MENU_LABELS.create.en },
              { label: ACTION_MENU_LABELS.listAll[currentLang] || ACTION_MENU_LABELS.listAll.en },
            ]}
            selectedIndex={selectedIndex}
            currentLang={currentLang}
          />
        );

      case "action-list":
        return (
          <SelectMenu
            items={actionsList.map((a) => ({
              label: a.name,
              desc: a.description,
            }))}
            selectedIndex={selectedIndex}
            currentLang={currentLang}
          />
        );

      case "action-detail":
        return (
          <SelectMenu
            items={[
              { label: ACTION_MENU_LABELS.run[currentLang] || ACTION_MENU_LABELS.run.en },
              { label: ACTION_MENU_LABELS.edit[currentLang] || ACTION_MENU_LABELS.edit.en },
              { label: ACTION_MENU_LABELS.delete[currentLang] || ACTION_MENU_LABELS.delete.en },
            ]}
            selectedIndex={selectedIndex}
            currentLang={currentLang}
          />
        );

      default:
        return null;
    }
  }

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
      {!isSubMenu ? (
        <>
          <Box>
            <Text color={isLoading ? "gray" : "#97DCE2"} bold>
              {"  ❯ "}
            </Text>
            <TextInput
              value={input}
              onChange={handleInputChange}
              onSubmit={handleSubmit}
              placeholder={
                isLoading ? "waiting..." : "Type / for commands, or ask anything..."
              }
              focus={!isLoading && !isRemoteLocked && (!isMenuMode || mode === "command-select")}
            />
          </Box>
          <Separator width={termWidth} />
        </>
      ) : null}

      {/* Dynamic menu (command-select renders below input, sub-menus below separator) */}
      {renderMenu()}

      {/* Usage display */}
      {mode === "usage-display" && usageData && (
        <Box flexDirection="column" paddingLeft={2} paddingRight={2}>
          <Box marginTop={1}>
            <Text bold>Credits Usage (30 days)</Text>
          </Box>
          <Box marginTop={1}>
            <UsageBar
              used={usageData.totalCreditsUsed}
              total={usageData.initialBalance}
              balance={usageData.balance}
              width={Math.min(termWidth - 8, 60)}
            />
          </Box>
        </Box>
      )}

      {/* Sub-menu hint at bottom */}
      {isSubMenu && (
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor>↑↓ select  Enter confirm  Esc cancel</Text>
        </Box>
      )}
    </Box>
  );
}
