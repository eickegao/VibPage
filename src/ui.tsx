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
  description: string;
  prompt: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/publish",
    description: "Build and deploy site to Cloudflare Pages",
    prompt: "Please publish my site to Cloudflare Pages using the publish tool.",
  },
  {
    name: "/init",
    description: "Initialize VibPage project",
    prompt: "Please initialize this VibPage project using the init tool.",
  },
  {
    name: "/status",
    description: "Show project status",
    prompt: "Please check the current project status: is it initialized? Are Astro and Wrangler installed? Is Cloudflare configured? Show me a summary.",
  },
  {
    name: "/language",
    description: "Set response language",
    prompt: "",
  },
  {
    name: "/help",
    description: "Show available commands",
    prompt: "",
  },
  {
    name: "/exit",
    description: "Quit VibPage",
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

      // /help
      if (cmd.name === "/help") {
        const helpText = SLASH_COMMANDS.map(
          (c) => `${c.name}  ${c.description}`
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
                  <Text color="#97DCE2">{"  "}{cmd.description}</Text>
                </>
              ) : (
                <>
                  <Text>{"  "}</Text>
                  <Text color="white">{cmd.name}</Text>
                  <Text color="gray">{"  "}{cmd.description}</Text>
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
