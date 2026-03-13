# VibPage CLI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI-powered browser automation (RPA) CLI that uses OpenAI Computer Use + Playwright to execute tasks on any website via natural language commands.

**Architecture:** Node.js + TypeScript CLI using `@mariozechner/pi-ai` for multi-model LLM support and `@mariozechner/pi-agent-core` for the agent runtime. Core RPA capability powered by OpenAI Computer Use API (gpt-5.4) with Playwright as the browser execution layer. Interactive terminal UI via Ink (React).

**Tech Stack:** TypeScript, pi-ai, pi-agent-core, Playwright, OpenAI Computer Use, Ink, turndown, commander, chalk

---

## File Structure

```
vibpage/
├── package.json              # Project config, dependencies, bin entry
├── tsconfig.json             # TypeScript config
├── src/
│   ├── index.tsx             # CLI entry point (commander + Ink UI)
│   ├── agent.ts              # Agent setup, tool registration
│   ├── config.ts             # Global config (~/.vibpage/config.json)
│   ├── project-config.ts     # Project config (.vibpage.json)
│   ├── ui.tsx                # Terminal UI (Ink/React, slash commands)
│   ├── tools/
│   │   ├── browser-task.ts   # Core RPA: OpenAI Computer Use + Playwright
│   │   ├── file.ts           # read_file / write_file tools
│   │   ├── web-fetch.ts      # web_fetch tool
│   │   ├── web-search.ts     # web_search tool (DuckDuckGo)
│   │   ├── screenshot.ts     # screenshot tool (Playwright headless)
│   │   ├── shell.ts          # shell_execute tool
│   │   ├── init.ts           # Project initialization
│   │   └── publish.ts        # Cloudflare Pages deploy
│   └── utils/
│       └── html-to-md.ts     # HTML to Markdown conversion
└── CLAUDE.md                 # Project instructions
```

---

## Core Components

### Browser Task Engine (browser-task.ts)
The central RPA capability:
1. Opens visible Playwright browser with persistent context
2. Navigates to target URL
3. Takes screenshot → sends to OpenAI gpt-5.4 Computer Use API
4. Receives actions (click, type, scroll, keypress, etc.)
5. Executes actions via Playwright
6. Loops until task completion (max 50 turns)
7. Browser stays open for user inspection

### Slash Commands (ui.tsx)
- `/run` — Execute browser automation task
- `/publish` — Build + deploy to Cloudflare Pages
- `/open-browser` / `/close-browser` — Manual browser control
- `/language` — Switch UI language (9 languages)
- `/init`, `/status`, `/help`, `/exit`

### Multi-Language (9 languages)
All UI text, slash command descriptions, and welcome messages translated:
zh-CN, zh-TW, en, fr, de, es, pt, ko, ja
