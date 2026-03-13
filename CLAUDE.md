# VibPage CLI

AI-powered browser automation (RPA) CLI tool.

## Tech Stack
- Node.js + TypeScript
- @mariozechner/pi-ai + pi-agent-core for multi-model LLM
- Playwright for browser automation
- OpenAI Computer Use API (gpt-5.4) for AI-driven browser control
- turndown for HTML-to-Markdown

## Commands
- `npm run build` — compile TypeScript
- `npm run dev` — watch mode
- `npm start` — run CLI

## Project Structure
- src/index.ts — CLI entry point
- src/agent.ts — Agent setup and event loop
- src/config.ts — Config management
- src/tools/ — AI agent tools (browser-task, file, web-fetch, web-search, screenshot, shell, publish, init)
- src/utils/ — Utilities
