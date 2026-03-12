# VibPage Publish 功能设计文档

## 概述

为 VibPage CLI 添加本地发布功能。用户在 CLI 中写完文章后，可以直接从本地构建并部署到 Cloudflare Pages，无需服务器。

## 启动流程变更

### 信任目录
程序启动时询问用户是否信任当前目录。用户确认后才进入对话模式。

### 自动 /init
启动后自动执行初始化：
1. 检查当前目录下 `.vibpage.json` 是否存在
2. 不存在 → 生成默认配置文件
3. 存在 → 读取配置
4. 检查 Astro 是否已安装，未安装则通过 npm 安装
5. （预留）从 GitHub 仓库下载模板文件 — 第一版暂不实施

## /publish 流程

### 触发方式
- 对话中输入 `/publish`
- 或自然语言触发（如"帮我发布"）

### 执行步骤
1. 读取 `.vibpage.json` 中的 Cloudflare 配置
2. 如果缺少必要配置（Token、Account ID、项目名），引导用户设置并写入配置文件
3. 将用户的 Markdown 文件放入 Astro 模板目录
4. 本地执行 `npx astro build` 生成静态文件
5. 执行 `npx wrangler pages deploy dist` 上传到 Cloudflare Pages
6. 返回部署后的 URL 给用户

## 配置文件

路径：项目目录下 `.vibpage.json`（文件权限 600）

```json
{
  "cloudflare": {
    "apiToken": "",
    "accountId": "",
    "projectName": ""
  },
  "template": {
    "source": "github",
    "repo": ""
  }
}
```

字段说明：
- `cloudflare.apiToken`：Cloudflare API Token（需要 Pages 权限）
- `cloudflare.accountId`：Cloudflare Account ID
- `cloudflare.projectName`：Cloudflare Pages 项目名（即子域名）
- `template.source`：模板来源（"github" 或将来的 "vibpage-server"）
- `template.repo`：模板 GitHub 仓库地址

## Astro 集成

- Astro 框架通过 npm 安装到项目目录
- 模板文件（layouts、components、styles）从 GitHub 仓库下载 — 第一版暂不实施，预留接口
- 用户的 Markdown 文件放入 Astro 的 `src/content/` 目录
- `astro build` 输出到 `dist/`

## 新增工具

### publish 工具
AI agent 可调用的工具，执行完整的构建 + 部署流程。

### init 工具
初始化项目：检查/创建配置文件，安装 Astro。

## 新增/修改文件

```
src/
├── tools/
│   ├── publish.ts        # 构建 + 部署工具
│   └── init.ts           # 项目初始化工具
├── project-config.ts     # .vibpage.json 读写
├── index.tsx             # 启动流程加信任确认 + 自动 init
└── agent.ts              # 注册新工具，system prompt 加发布说明
```

## 第一版范围

实施：
- 启动信任确认
- `/init` 基本流程（配置文件管理 + Astro 安装）
- `/publish`（Cloudflare 配置引导 + 构建 + 部署）
- `.vibpage.json` 配置管理

暂不实施：
- 从 GitHub 下载模板（预留接口）
- 模板选择 UI

## 依赖新增

| 包名 | 用途 |
|------|------|
| `wrangler` | Cloudflare Pages 部署（用户项目级安装） |
| `astro` | 静态站点构建（用户项目级安装） |

注：wrangler 和 astro 不作为 vibpage 的依赖，而是在 `/init` 时安装到用户的项目目录中。
