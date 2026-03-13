# VibPage Publish 功能设计文档

## 概述

VibPage CLI 的网站发布功能。用户写完文章后，可以直接构建并部署到 Cloudflare Pages。这是 VibPage RPA 能力的一个内置场景。

## /publish 流程

### 触发方式
- 斜杠命令 `/publish`
- 自然语言触发（如"帮我发布"）

### 执行步骤
1. 检查 wrangler 登录状态（`wrangler whoami`）
2. 未登录则执行 `wrangler login`（打开浏览器 OAuth 授权）
3. 获取 Account ID
4. 确认 Cloudflare Pages 项目名（默认用目录名）
5. 复制 `.md` 文件到 `src/content/`
6. 执行 `npx astro build`
7. 如需要，创建 Cloudflare Pages 项目
8. 执行 `wrangler pages deploy dist`
9. 返回部署 URL

## 配置文件

路径：项目目录下 `.vibpage.json`

```json
{
  "language": "zh-CN",
  "author": "",
  "cloudflare": {
    "projectName": ""
  },
  "template": {
    "source": "github",
    "repo": ""
  }
}
```

## 依赖

| 包名 | 用途 |
|------|------|
| `wrangler` | Cloudflare Pages 部署（devDependency） |
| `astro` | 静态站点构建（devDependency） |
