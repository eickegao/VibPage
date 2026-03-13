import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, Static, useApp, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { Agent } from "@mariozechner/pi-agent-core";

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

function MessageItem({ msg }: { msg: Message }) {
  switch (msg.role) {
    case "user":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="#97DCE2" bold>
            {"  You: "}{msg.text}
          </Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginTop={1}>
          {msg.text.split("\n").map((line, i) => (
            <Text key={i}>
              {i === 0 ? (
                <Text color="#41BAC7" bold>{"  VibPage: "}</Text>
              ) : (
                <Text>{"          "}</Text>
              )}
              <Text>{line}</Text>
            </Text>
          ))}
        </Box>
      );
    case "tool":
      return (
        <Text dimColor>{"          "}{msg.text}</Text>
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

  // Show slash command suggestions when input starts with /
  const showSuggestions = input.startsWith("/") && !isLoading;
  const filteredCommands = showSuggestions
    ? SLASH_COMMANDS.filter((cmd) =>
        cmd.name.startsWith(input.toLowerCase())
      )
    : [];

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

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setInput("");

      // Handle /exit
      if (trimmed === "/exit" || trimmed === "exit" || trimmed === "quit") {
        exit();
        return;
      }

      // Handle /help
      if (trimmed === "/help") {
        const helpText = SLASH_COMMANDS.map(
          (cmd) => `${cmd.name}  ${cmd.description}`
        ).join("\n");
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: trimmed },
          { id: nextId(), role: "assistant", text: helpText },
        ]);
        return;
      }

      // Handle slash commands
      const cmd = SLASH_COMMANDS.find((c) => c.name === trimmed);
      if (cmd && cmd.prompt) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", text: trimmed },
        ]);
        await sendPrompt(cmd.prompt);
        return;
      }

      // Regular message
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed },
      ]);
      await sendPrompt(trimmed);
    },
    [agent, exit, sendPrompt]
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
                <Text color="#41BAC7" bold>{"  VibPage: "}</Text>
              ) : (
                <Text>{"          "}</Text>
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

      {/* Input area with top and bottom borders */}
      <Separator width={termWidth} />
      <Box>
        <Text color={isLoading ? "gray" : "#97DCE2"} bold>
          {"  ❯ "}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={
            isLoading ? "waiting..." : "Type / for commands, or ask anything..."
          }
          focus={!isLoading}
        />
      </Box>
      <Separator width={termWidth} />

      {/* Slash command suggestions below input */}
      {showSuggestions && filteredCommands.length > 0 && (
        <Box flexDirection="column">
          {filteredCommands.map((cmd) => (
            <Box key={cmd.name}>
              <Text>{"  "}</Text>
              <Text color="#41BAC7" bold>{cmd.name}</Text>
              <Text dimColor>{"  "}{cmd.description}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
