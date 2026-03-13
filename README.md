# VibPage

AI-powered browser automation (RPA) CLI. Describe tasks in natural language, and AI operates the browser for you — fill forms, post to social media, download reports, and more.

![VibPage Screenshot](docs/screenshot.png)

## Features

- **Browser Automation** - AI sees the screen and operates the browser like a human, powered by OpenAI Computer Use
- **Any Website** - Works on any site: X, LinkedIn, Gmail, Notion, internal tools, etc.
- **Actions** - Save reusable automation workflows as Markdown files, share them by copying `.md` files
- **Persistent Sessions** - Login once, sessions are saved for future runs
- **Multi-Language** - Supports 9 languages: 简体中文, 繁體中文, English, Français, Deutsch, Español, Português, 한국어, 日本語
- **Slash Commands** - Arrow-key navigable command menu with `/` prefix
- **Multi-Model** - Supports Anthropic, OpenAI, and Google AI models

## Install

```bash
git clone https://github.com/eickegao/VibPage.git
cd VibPage
npm install
npm run build
npm link
```

## Setup

Create `~/.vibpage/config.json`:

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "apiKey": "your-api-key"
}
```

Supported providers: `anthropic`, `openai`, `google`

You can also use environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`

> **Note:** Browser automation requires an OpenAI API key with access to `gpt-5.4` (Computer Use).

## Usage

```bash
# Run in any directory
vibpage

# With options
vibpage -p openai -m gpt-4o
```

### Examples

```
> 帮我登录 X，发一条推文："Hello from VibPage!"
> Go to LinkedIn and post an article about AI automation
> 打开 Notion，创建一个新页面
> Download the monthly report from our dashboard
```

### Slash Commands

Type `/` to see available commands:

| Command | Description |
|---------|-------------|
| `/action` | Manage automation actions |
| `/run` | Run a browser automation task |
| `/language` | Set response language |
| `/open-browser` | Open browser |
| `/close-browser` | Close browser |
| `/help` | Show all commands |
| `/exit` | Quit |

### How It Works

1. You describe a task in natural language
2. AI opens a visible browser and navigates to the target website
3. AI takes screenshots, understands the page, and performs actions (click, type, scroll)
4. The loop continues until the task is complete
5. Browser sessions are preserved in `~/.vibpage/browser-data/`

### Actions

Actions are reusable automation workflows stored as Markdown files in `~/.vibpage/Actions/`. They support parameters with `{param_name}` syntax.

```
> 创建一个 Action：自动发推文
> 运行 Action "post-to-x"，内容是 "Hello World"
> 列出所有 Actions
```

Share actions by copying `.md` files to another user's `~/.vibpage/Actions/` directory.

## Project Structure

```
src/
├── index.tsx          # CLI entry, banner, startup
├── agent.ts           # AI agent setup, system prompt
├── config.ts          # Global config (~/.vibpage/config.json)
├── project-config.ts  # Project config (.vibpage.json)
├── ui.tsx             # Terminal UI (Ink/React)
├── tools/
│   ├── browser-task.ts # Browser automation (OpenAI Computer Use + Playwright)
│   ├── action.ts      # Reusable automation actions (CRUD)
│   ├── file.ts        # Read/write files
│   ├── web-fetch.ts   # Fetch web pages as Markdown
│   ├── web-search.ts  # DuckDuckGo search
│   ├── screenshot.ts  # Web page screenshots (Playwright)
│   └── shell.ts       # Shell command execution
└── utils/
    └── html-to-md.ts  # HTML to Markdown conversion
```

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **AI**: [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono) (unified multi-model API)
- **Browser**: [Playwright](https://playwright.dev/) + [OpenAI Computer Use](https://platform.openai.com/docs/guides/tools-computer-use) (AI-driven automation)
- **UI**: [Ink](https://github.com/vadimdemedes/ink) (React for terminal)

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.
