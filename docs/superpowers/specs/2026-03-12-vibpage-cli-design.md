# VibPage CLI 设计文档

## 概述

VibPage CLI 是一个 AI 驱动的浏览器自动化（RPA）命令行工具。用户用自然语言描述任务，AI 自动操作浏览器完成操作 — 填表、发帖、下载报表、与任意网站交互。同时保留内容创作和网站发布能力。

## 技术栈

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| 运行时 | Node.js + TypeScript | 主流，生态丰富 |
| AI 框架 | `@mariozechner/pi-ai` + `pi-agent-core` | MIT 许可，统一多模型 API + agent 工具调用运行时 |
| 浏览器自动化 | Playwright + OpenAI Computer Use (gpt-5.4) | AI 视觉驱动的浏览器操作 |
| 网页截图 | Playwright（Chromium） | 无头/有头浏览器 |
| 终端 UI | Ink (React for terminal) | 交互式命令行界面 |
| 分发 | npm | `npm install -g vibpage` |

## 核心能力

### 1. 浏览器自动化（RPA）
- AI 通过截图理解页面内容，自主决定操作（点击、输入、滚动等）
- 持久化浏览器会话（`~/.vibpage/browser-data/`），登录状态跨会话保留
- 支持任意网站，不绑定特定平台
- 可见浏览器窗口，用户可实时监控

### 2. 内容创作
- AI 辅助写作（文章、博客等）
- 网页搜索和资料获取
- Markdown 格式输出

### 3. 网站发布
- Astro 静态站点构建
- Cloudflare Pages 一键部署
- Wrangler OAuth 登录（无需手动 API token）

## 支持的 AI 模型

通过 pi-ai 统一 API：
- Anthropic Claude（对话和内容创作）
- OpenAI GPT（对话）+ gpt-5.4（Computer Use 浏览器自动化）
- Google Gemini（对话）

## 交互方式

对话式交互 + 斜杠命令菜单。

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/run` | 执行浏览器自动化任务 |
| `/publish` | 构建并部署网站 |
| `/init` | 初始化项目 |
| `/status` | 显示项目状态 |
| `/language` | 设置语言（9 种） |
| `/open-browser` | 打开浏览器 |
| `/close-browser` | 关闭浏览器 |
| `/help` | 显示所有命令 |
| `/exit` | 退出 |

### 使用示例

```
> 帮我登录 X，发一条推文
> 打开 LinkedIn，发布一篇关于 AI 的文章
> 去后台系统下载这个月的销售报表
> 帮我在 Notion 里创建一个新页面
> 写一篇关于 Cloudflare Workers 的教程，然后发布到网站
```

## AI 工具集

### 1. browser_task（核心工具）
- 输入：URL + 自然语言任务描述
- 使用 OpenAI Computer Use API 驱动 Playwright 浏览器
- 截图 → AI 分析 → 执行操作 → 循环
- 最多 50 轮交互

### 2. read_file / write_file
- 文件读写，限制在工作目录内

### 3. web_fetch
- 抓取网页内容，转为 Markdown

### 4. web_search
- DuckDuckGo HTML 搜索，无需 API key

### 5. screenshot
- Playwright 无头浏览器截图

### 6. shell_execute
- 执行 shell 命令

### 7. init / publish
- 项目初始化和 Cloudflare Pages 部署

## 配置

### 全局配置：`~/.vibpage/config.json`

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "apiKey": "your-api-key"
}
```

### 项目配置：`.vibpage.json`

```json
{
  "language": "zh-CN",
  "author": "",
  "cloudflare": { "projectName": "" },
  "template": { "source": "github", "repo": "" }
}
```

### 浏览器数据：`~/.vibpage/browser-data/`
- Playwright 持久化上下文，保存登录 cookie 等

## 多语言支持

9 种语言：简体中文、繁體中文、English、Français、Deutsch、Español、Português、한국어、日本語

## 项目结构

```
src/
├── index.tsx          # CLI 入口
├── agent.ts           # Agent 设置和系统提示
├── config.ts          # 全局配置
├── project-config.ts  # 项目配置
├── ui.tsx             # 终端 UI (Ink/React)
├── tools/
│   ├── browser-task.ts # 浏览器自动化（Computer Use + Playwright）
│   ├── file.ts        # 文件读写
│   ├── web-fetch.ts   # 网页抓取
│   ├── web-search.ts  # 网页搜索
│   ├── screenshot.ts  # 截图
│   ├── shell.ts       # Shell 命令
│   ├── init.ts        # 项目初始化
│   └── publish.ts     # 网站发布
└── utils/
    └── html-to-md.ts  # HTML 转 Markdown
```
