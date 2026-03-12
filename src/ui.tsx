import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { Agent } from "@mariozechner/pi-agent-core";

interface Message {
  role: "user" | "assistant" | "tool" | "status";
  text: string;
}

interface AppProps {
  agent: Agent;
  config: { provider: string; model: string };
}

export function App({ agent, config }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const currentTextRef = useRef("");

  const termHeight = stdout?.rows ?? 24;
  const headerHeight = 3;
  const inputHeight = 3;
  const availableHeight = termHeight - headerHeight - inputHeight - 1;

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
              { role: "assistant", text: finalText },
            ]);
          }
          setStreamingText("");
          currentTextRef.current = "";
          break;
        }
        case "tool_execution_start":
          setMessages((prev) => [
            ...prev,
            { role: "tool", text: `🔧 ${event.toolName}` },
          ]);
          break;
        case "tool_execution_end":
          setMessages((prev) => [
            ...prev,
            {
              role: "tool",
              text: event.isError
                ? `❌ ${event.toolName} failed`
                : `✓ ${event.toolName} done`,
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
      setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
      setIsLoading(true);

      try {
        await agent.prompt(trimmed);
        await agent.waitForIdle();
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { role: "status", text: `Error: ${err.message}` },
        ]);
      }

      setIsLoading(false);
    },
    [agent, exit]
  );

  // Build visible messages (show last N lines that fit)
  const renderMessages = () => {
    const allLines: { role: string; text: string }[] = [];

    for (const msg of messages) {
      const lines = msg.text.split("\n");
      for (const line of lines) {
        allLines.push({ role: msg.role, text: line });
      }
    }

    // Add streaming text
    if (streamingText) {
      const lines = streamingText.split("\n");
      for (const line of lines) {
        allLines.push({ role: "assistant", text: line });
      }
    }

    // Show only lines that fit
    const visible = allLines.slice(-availableHeight);

    return visible.map((line, i) => {
      switch (line.role) {
        case "user":
          return (
            <Text key={i} color="green" bold>
              {"❯ "}
              {line.text}
            </Text>
          );
        case "assistant":
          return (
            <Text key={i} color="white">
              {line.text}
            </Text>
          );
        case "tool":
          return (
            <Text key={i} dimColor>
              {line.text}
            </Text>
          );
        case "status":
          return (
            <Text key={i} color="red">
              {line.text}
            </Text>
          );
        default:
          return (
            <Text key={i}>{line.text}</Text>
          );
      }
    });
  };

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Header */}
      <Box
        borderStyle="single"
        borderColor="cyan"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold color="cyan">
          ✨ VibPage
        </Text>
        <Text dimColor>
          {config.provider}/{config.model}
        </Text>
      </Box>

      {/* Messages Area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {renderMessages()}
      </Box>

      {/* Input Area */}
      <Box
        borderStyle="single"
        borderColor={isLoading ? "yellow" : "green"}
        paddingX={1}
      >
        {isLoading ? (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text color="yellow"> Thinking...</Text>
          </Box>
        ) : (
          <Box>
            <Text color="green" bold>
              {"❯ "}
            </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Ask me to write something..."
              focus={!isLoading}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
