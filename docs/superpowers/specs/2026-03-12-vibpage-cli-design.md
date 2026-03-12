# VibPage CLI 设计文档

## 概述

VibPage CLI 是一个对话式 AI agent 命令行工具，专注于内容创作场景。用户在终端中与 AI 对话，AI 可以自主搜索资料、抓取网页、截图、执行命令，最终生成 Markdown 文章并保存为本地文件。

## 技术栈

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| 运行时 | Node.js + TypeScript | 主流，生态丰富 |
| AI 框架 | `@mariozechner/pi-ai` + `pi-agent-core` | MIT 许可，统一多模型 API + agent 工具调用运行时 |
| 网页截图 | Playwright（仅 Chromium） | 无头浏览器，截图能力 |
| 分发 | npm（第一版），后续加独立二进制 | `npm install -g vibpage` |

## 支持的 AI 模型

通过 pi-ai 统一 API，第一版即支持：
- Anthropic Claude
- OpenAI GPT
- Google Gemini

## API Key 策略

第一版：用户自行配置 API key（通过配置文件或环境变量）。

支持的环境变量：
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`

优先级：环境变量 > 配置文件

后续扩展：VibPage 后端代理服务，用户无需自带 key。

## 交互方式

对话式交互。用户启动 CLI 后进入对话模式，与 AI 持续对话完成内容创作。

### 启动流程

1. 用户运行 `vibpage`
2. CLI 自动为本次会话生成文件名（如 `2026-03-12-untitled.md`）
3. 告知用户：「文章将保存到 ./2026-03-12-untitled.md」
4. 进入对话模式，用户描述需求，AI 生成内容
5. AI 生成内容后可根据主题重命名文件（旧文件自动删除）

### 对话示例

```
$ vibpage

📄 文章将保存到 ./2026-03-12-untitled.md

> 帮我写一篇关于 Cloudflare Workers 的入门教程

（AI 自动搜索 DuckDuckGo，抓取 Cloudflare 文档，生成文章并保存）

📄 文件已重命名为 ./2026-03-12-cloudflare-workers-guide.md

> 再加一段关于定价的内容

（AI 抓取定价页面，追加内容）

> 帮我截个图看看竞品 Vercel Edge Functions 的页面

（AI 搜索、截图、分析）
```

## 安全模型

### 文件操作

- 文件读写默认限制在当前工作目录及子目录
- 访问工作目录外的文件需要用户确认

### 命令执行

- 所有 shell 命令执行前需显示命令内容，等待用户确认（y/n）
- 只读命令（ls、cat、pwd 等）可配置为自动允许

### 截图

- 截图保存在当前工作目录下

## AI 工具集

AI agent 可以自主决定何时调用以下工具：

### 1. 读/写文件（File Read/Write）

- **读取文件**：读取文件内容（默认限制在工作目录内）
- **写入文件**：创建或覆盖文件，支持自动命名
- 文章开始时自动命名，AI 可在过程中根据内容更新文件名（自动删除旧文件）
- 支持 Markdown 及其他文本格式

### 2. Web Fetch

- 给定 URL，抓取页面内容并转为文本/Markdown
- 用途：获取参考资料、查阅文档、获取最新信息
- 实现：Node.js 原生 `fetch` + HTML-to-Markdown 转换（turndown）
- AI 可自主决定何时需要抓取网页（如写文章时需要参考资料），用户也可主动要求

### 3. Web 搜索（Search）

- 通过 fetch DuckDuckGo HTML 搜索结果页面实现
- 解析返回的 HTML，提取链接和摘要
- 无需 API key
- 注意：此方案为实验性，DuckDuckGo 的 HTML 结构可能变化导致解析失败。如遇问题，后续可切换到 Brave Search API（有免费额度）或自托管 SearXNG
- AI 可自主搜索，也可由用户指示

### 4. 网页截图（Screenshot）

- 使用 Playwright 无头浏览器（仅安装 Chromium，约 150MB）截图
- 输入：URL
- 输出：保存为本地 PNG 图片文件
- AI 可自主判断何时需要截图（如分析竞品页面）
- 首次使用时提示用户安装 Chromium，显示下载进度

### 5. 执行命令（Shell Execute）

- 执行本地 shell 命令
- 用途：创建目录、移动文件、查看目录结构等
- 执行前需用户确认
- 返回命令输出给 AI

## CLI 接口

```
vibpage [options]

Options:
  -m, --model <model>      指定 AI 模型（默认：claude-sonnet-4-20250514）
  -p, --provider <name>    指定模型提供商（anthropic/openai/google）
  -o, --output <dir>       输出目录（默认：当前目录）
  -c, --config <path>      配置文件路径（默认：~/.vibpage/config.json）
  -v, --version            显示版本号
  -h, --help               显示帮助信息
```

## 项目结构

```
vibpage/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI 入口 + 参数解析
│   ├── agent.ts              # Agent 初始化和对话循环
│   ├── config.ts             # 配置管理（API key、模型选择等）
│   ├── tools/
│   │   ├── file.ts           # 文件读写工具
│   │   ├── web-fetch.ts      # Web Fetch 工具
│   │   ├── web-search.ts     # DuckDuckGo 搜索工具
│   │   ├── screenshot.ts     # 网页截图工具
│   │   └── shell.ts          # Shell 命令执行工具
│   └── utils/
│       ├── html-to-md.ts     # HTML 转 Markdown
│       └── logger.ts         # 日志工具
├── CLAUDE.md
└── README.md
```

## 配置

配置文件位于 `~/.vibpage/config.json`（文件权限设为 600）：

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "apiKey": "",
  "outputDir": "."
}
```

- `provider`：AI 模型提供商（anthropic / openai / google）
- `model`：具体模型 ID（随模型更新调整默认值）
- `apiKey`：用户的 API key（也可通过环境变量设置）
- `outputDir`：文章默认输出目录

首次运行时如无配置文件，引导用户配置 API key。

## 依赖清单

| 包名 | 用途 |
|------|------|
| `@mariozechner/pi-ai` | 统一多模型 LLM API |
| `@mariozechner/pi-agent-core` | Agent 运行时 + 工具调用 |
| `playwright` | 网页截图（仅 Chromium） |
| `turndown` | HTML 转 Markdown |
| `commander` | CLI 参数解析 |
| `chalk` | 终端颜色输出 |
| `readline` | 用户输入（Node.js 内置） |

## 错误处理

- **网络失败**（web fetch/搜索）：提示用户网络错误，AI 继续对话，可稍后重试
- **API 错误**（rate limit/token 耗尽）：显示具体错误信息，建议用户检查 key 或稍后重试
- **Playwright 崩溃**：捕获异常，提示截图失败，不中断对话
- **磁盘空间不足**：写文件失败时提示用户

## 后续扩展

以下功能不在第一版范围内，但设计时预留扩展空间：

1. **发布到 Cloudflare Pages** — `vibpage publish` 命令
2. **Astro 模板系统** — 多模板选择
3. **独立二进制分发** — 不依赖 Node.js 环境
4. **VibPage 后端代理服务** — 用户无需自带 API key
5. **对话持久化** — 保存/恢复对话历史
