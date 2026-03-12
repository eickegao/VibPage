import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, Static, useApp, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { Agent } from "@mariozechner/pi-agent-core";

interface Message {
  id: number;
  role: "user" | "assistant" | "tool" | "status" | "divider";
  text: string;
  timestamp: string;
}

interface AppProps {
  agent: Agent;
  config: { provider: string; model: string };
}

let messageId = 0;
function nextId() {
  return ++messageId;
}

function timeStamp(): string {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Tool status icons (Gemini-style)
const TOOL_ICONS = {
  start: "◦",
  success: "✓",
  error: "✗",
} as const;

function addMsg(
  prev: Message[],
  role: Message["role"],
  text: string
): Message[] {
  return [...prev, { id: nextId(), role, text, timestamp: timeStamp() }];
}

// Render a single completed message
function MessageItem({ msg }: { msg: Message }) {
  switch (msg.role) {
    case "divider":
      return (
        <Box marginY={0}>
          <Text dimColor>
            {"─".repeat(60)}
          </Text>
        </Box>
      );
    case "user":
      return (
        <Box flexDirection="column" marginY={0}>
          <Box>
            <Text color="green" bold>
              {"❯ "}
            </Text>
            <Text color="green" bold>
              {msg.text}
            </Text>
            <Text dimColor>{"  "}{msg.timestamp}</Text>
          </Box>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginY={0}>
          <Box flexDirection="column">
            {msg.text.split("\n").map((line, i) => (
              <Box key={i}>
                {i === 0 ? (
                  <Text color="cyan" bold>{"✦ "}</Text>
                ) : (
                  <Text>{"  "}</Text>
                )}
                <Text>{line}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      );
    case "tool":
      return (
        <Box>
          <Text dimColor>{"  "}{msg.text}</Text>
        </Box>
      );
    case "status":
      return (
        <Box>
          <Text color="red">{"  ⚠ "}{msg.text}</Text>
        </Box>
      );
    default:
      return <Text>{msg.text}</Text>;
  }
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

  const termWidth = stdout?.columns ?? 80;

  // Elapsed timer during loading
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
            setMessages((prev) => addMsg(prev, "assistant", finalText));
          }
          setStreamingText("");
          currentTextRef.current = "";
          break;
        }
        case "tool_execution_start":
          setToolStatus(event.toolName);
          setMessages((prev) =>
            addMsg(prev, "tool", `${TOOL_ICONS.start} ${event.toolName}`)
          );
          break;
        case "tool_execution_end":
          setToolStatus("");
          setMessages((prev) =>
            addMsg(
              prev,
              "tool",
              event.isError
                ? `${TOOL_ICONS.error} ${event.toolName} failed`
                : `${TOOL_ICONS.success} ${event.toolName}`
            )
          );
          break;
      }
    });
    return unsubscribe;
  }, [agent]);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      if (trimmed === "exit" || trimmed === "quit") {
        exit();
        return;
      }

      setInput("");
      setMessages((prev) => {
        const withDivider =
          prev.length > 0 ? addMsg(prev, "divider", "") : prev;
        return addMsg(withDivider, "user", trimmed);
      });
      setIsLoading(true);

      try {
        await agent.prompt(trimmed);
        await agent.waitForIdle();
      } catch (err: any) {
        setMessages((prev) => addMsg(prev, "status", err.message));
      }

      setIsLoading(false);
    },
    [agent, exit]
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold color="cyan">
          ✦ VibPage
        </Text>
        <Text dimColor>
          {config.provider}/{config.model} | "exit" to quit
        </Text>
      </Box>

      {/* Completed Messages (pinned, won't re-render) */}
      <Static items={messages}>
        {(msg) => (
          <Box key={msg.id} paddingX={1}>
            <MessageItem msg={msg} />
          </Box>
        )}
      </Static>

      {/* Streaming text (active response) */}
      {streamingText && (
        <Box flexDirection="column" paddingX={1}>
          {streamingText.split("\n").map((line, i) => (
            <Box key={i}>
              {i === 0 ? (
                <Text color="cyan" bold>{"✦ "}</Text>
              ) : (
                <Text>{"  "}</Text>
              )}
              <Text>{line}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Status bar when loading */}
      {isLoading && (
        <Box paddingX={1} gap={1}>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text color="yellow" bold>
            {toolStatus
              ? `Running ${toolStatus}...`
              : "Thinking..."}
          </Text>
          <Text dimColor>
            {formatElapsed(elapsedSec)}
          </Text>
        </Box>
      )}

      {/* Input Area */}
      <Box
        borderStyle="round"
        borderColor={isLoading ? "gray" : "green"}
        paddingX={1}
        marginTop={0}
      >
        <Text color={isLoading ? "gray" : "green"} bold>
          {"❯ "}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={
            isLoading ? "Waiting for response..." : "Ask me to write something..."
          }
          focus={!isLoading}
        />
      </Box>
    </Box>
  );
}
