import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, Static, useApp } from "ink";
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

function MessageItem({ msg }: { msg: Message }) {
  switch (msg.role) {
    case "user":
      return (
        <Box flexDirection="column">
          <Text>{""}</Text>
          <Text color="green" bold>
            {"  ❯ "}{msg.text}
          </Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column">
          {msg.text.split("\n").map((line, i) => (
            <Text key={i}>
              {i === 0 ? (
                <Text color="cyan" bold>{"  ✦ "}</Text>
              ) : (
                <Text>{"    "}</Text>
              )}
              <Text>{line}</Text>
            </Text>
          ))}
        </Box>
      );
    case "tool":
      return (
        <Text dimColor>{"    "}{msg.text}</Text>
      );
    case "status":
      return (
        <Text color="red">{"  ⚠ "}{msg.text}</Text>
      );
    default:
      return <Text>{msg.text}</Text>;
  }
}

export function App({ agent, config }: AppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState("");
  const currentTextRef = useRef("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      if (trimmed === "exit" || trimmed === "quit") {
        exit();
        return;
      }

      setInput("");
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed },
      ]);
      setIsLoading(true);

      try {
        await agent.prompt(trimmed);
        await agent.waitForIdle();
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "status", text: err.message },
        ]);
      }

      setIsLoading(false);
    },
    [agent, exit]
  );

  return (
    <Box flexDirection="column">
      {/* All completed messages - pinned, never re-render */}
      <Static items={messages}>
        {(msg) => (
          <MessageItem key={msg.id} msg={msg} />
        )}
      </Static>

      {/* Live area: streaming + status + input */}

      {/* Streaming text */}
      {streamingText && (
        <Box flexDirection="column">
          {streamingText.split("\n").map((line, i) => (
            <Text key={i}>
              {i === 0 ? (
                <Text color="cyan" bold>{"  ✦ "}</Text>
              ) : (
                <Text>{"    "}</Text>
              )}
              <Text>{line}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Loading status */}
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

      {/* Input */}
      <Box>
        <Text color={isLoading ? "gray" : "green"} bold>
          {"  ❯ "}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={
            isLoading ? "waiting..." : "Ask me to write something..."
          }
          focus={!isLoading}
        />
      </Box>
    </Box>
  );
}
