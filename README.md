# Personal Multi-Source RSS Reader (个人多源 RSS 阅读与知识工作流)

一个轻量、开箱即用、受 **Folo** 启发的多视图个人 RSS 阅读器 MVP（FastAPI + SQLite + React/Tailwind）。专为高信噪比信息摄取而设计：聚合财经、科技、Hacker News、YouTube、播客与社交媒体，内置 **L1 规则降噪 → L2 按需 AI 摘要 → L3 批量打包导出至 NotebookLM / Obsidian** 知识漏斗。

> **Local-First MVP**：本地启动**无需 Docker**，单条命令即可运行；同时在 [`deploy/docker-compose.yml`](deploy/docker-compose.yml) 提供 Phase 2 VPS 生产部署模板（Miniflux + ReactFlux + PostgreSQL 16/pgvector + RSSHub + Redis 8 + Browserless + Cloudflare Tunnel）。

---

## 核心特性 (Features)

- **多视图阅读体验 (Folo-Inspired Multi-View UI)**：
  - **Articles (财经/科技)**：三栏阅读布局，支持全文抓取（`trafilatura`）、快捷键操作（`j`/`k`/`s`/`m`/`o`）与深浅色模式切换。
  - **Hacker News (抗延迟高信噪比)**：基于 Algolia API 仅抓取 `points >= 100` 的高质量帖子；在条目首次突破阈值时记录 `discovered_at`，彻底解决传统 HN RSS 因 21 小时延迟被时间线淹没的问题，并支持阅读页一键展开嵌套热门评论。
  - **Videos (YouTube)**：支持直接粘贴 `@handle` 或频道链接自动解析 `channel_id`；勾选 **Exclude Shorts** 自动将 `UC...` 转为 `UULF...` 播放列表源过滤短视频，内置 `youtube-nocookie.com` 播放器。
  - **Podcasts (播客)**：支持 iTunes Search 在线搜播客；全局常驻底部音频播放器（切换视图不断播、自动同步播放进度 `playback_seconds`），自动识别 Shownotes 中的 `MM:SS` / `HH:MM:SS` 时间戳点击跳转。
  - **Social (社交媒体)**：支持 RSSHub / MediaCrawler 路由，所有外链图片经由带 **SSRF 防护** 的 `/api/image-proxy` 代理加载，突破防盗链限制。
- **L1 → L2 → L3 信息降噪与知识沉淀漏斗**：
  - **L1 规则降噪**：URL 规范化、标题+链接去重、关键词黑名单过滤。
  - **L2 按需 AI 摘要**：支持 Gemini (`gemini-2.5-flash`) 或 OpenAI 兼容接口，点击即生成并缓存于 SQLite，不浪费 Token。
  - **L3 批量打包导出 (Batch-Packed Markdown)**：按周/分类/收藏一键合并导出含 Obsidian YAML Frontmatter 的结构化 Markdown，实时计算字数并对照 **NotebookLM 50 来源 / 40 万词安全上限** 提示；支持可选 `nlm` CLI 直推。

---

## 一键本地启动 (Quick Start — No Docker Required)

### 环境要求 (Prerequisites)
- **Python 3.11+** 与 [`uv`](https://docs.astral.sh/uv/)
- **Node.js 20+** 与 `pnpm`（或 `npm`）
- **可选：[`just`](https://just.systems)**（推荐任务运行器，macOS 可通过 `brew install just` 安装）

### 1. 配置环境变量（可选）
```bash
cp .env.example .env
```
无需任何 API Key 即可完整运行阅读器；如需开启按需 AI 摘要，可在 `.env` 中填入 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`。

### 2. 单命令启动
```bash
./start.sh
# 或者使用 just（macOS：brew install just）：
just dev
```
启动成功后：
- **Web 界面**：`http://localhost:5173`
- **后端 API**：`http://127.0.0.1:8000`（Swagger 文档：`http://127.0.0.1:8000/docs`）
- 按 `Ctrl+C` 可同时优雅关闭前后端服务。

### 常用 Just 命令 (`justfile` Recipes)

如尚未安装 [`just`](https://just.systems)，可在 macOS 上执行 `brew install just`（其他平台参见[官方安装指南](https://just.systems/man/en/packages.html)）；直接运行 `just` 可列出全部任务分组与说明。

| 命令 | 说明 |
| :--- | :--- |
| `just` | 列出所有可用任务分组及说明（`just --list --unsorted`） |
| `just install` | 安装后端（`uv sync --group dev`）与前端（`pnpm`/`npm install`）全部依赖 |
| `just dev` | 调用 `./start.sh` 一键启动本地开发环境（也可单独运行 `just dev-backend` / `just dev-frontend`） |
| `just lint` | 运行后端 `ruff` + `mypy app tests` 与前端 `eslint` + `tsc --noEmit` |
| `just test` | 运行后端 `pytest` 与前端 `vitest` 单元测试 |
| `just build` | 构建生产前端静态包至 `frontend/dist` |
| `just check` | 一键运行完整质量门禁（`lint` + `test` + `build`） |
| `just clean` | 清理构建产物与工具缓存目录（保留本地 SQLite 数据库） |

> **持续集成 (CI)**：仓库已配置 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)，在推送或 PR 至 `main` 时自动运行后端（`ruff`、`mypy`、`pytest`）、前端（`eslint`、`tsc`、`vitest`、`vite build`）以及 `justfile` / 脚本 / YAML 校验。

---

## 预置精选订阅源 (Pre-Configured 2026 Starter Feeds)

首次启动数据库为空时，系统会自动导入以下经验证的 2026 高信噪比订阅源（也可在 **Add Feed → OPML / Starter Pack** 中随时重新导入，幂等安全）：

| 视图分类 | 订阅源 | 说明 |
| :--- | :--- | :--- |
| **Finance (财经)** | Bloomberg Markets & Technology | 彭博市场与科技官方 RSS |
| **Finance (财经)** | WSJ Markets | 已迁移至新版官方域名 `feeds.content.dowjones.io` |
| **Finance (财经)** | Financial Times | FT 首页要闻 RSS |
| **Finance (财经)** | Reuters (via Google News) | 24 小时滚动抓取 `site:reuters.com` 绕过路透停更限制 |
| **Finance (财经)** | CNBC Top News | CNBC 财经头条 |
| **Tech (科技)** | TechCrunch AI / The Verge / Ars Technica | 科技与 AI 深度报道 |
| **Hacker News** | High-Signal HN (`points >= 100`) | Algolia API 抗延迟源 + 嵌套热门评论 |
| **Videos (YouTube)** | 示例科技/AI 频道 | 支持 `@handle` 解析与 `UULF` 屏蔽 Shorts |
| **Podcasts (播客)** | 示例深度播客 (Acquired / Latent Space) | 支持全局常驻播放与 Shownotes 时间戳跳转 |

---

## 接入社交媒体：X / 知乎 / 小红书 (Social Integration)

由于 X (Twitter)、知乎、小红书等平台反爬较严，建议根据场景选择以下两种方案：

### 方案 A：通过 RSSHub 接入（推荐用于 X / 知乎 / 公开主页）
1. 在本地或 VPS 启动 RSSHub（默认地址 `http://localhost:1200`，可在 `.env` 中通过 `RSSHUB_BASE_URL` 配置）。
2. 在前端点击 **+ Add Feed → Social / RSSHub**，填入对应路由：
   - **X / Twitter**：`http://localhost:1200/twitter/user/<username>`
   - **知乎动态**：`http://localhost:1200/zhihu/people/activities/<user_id>`
   - **小红书笔记**：`http://localhost:1200/xiaohongshu/user/<user_id>/notes`
3. 视图类型选择 `Social`，外链图片将自动经由内置 `/api/image-proxy` 加载，避免防盗链裂图。

### 方案 B：通过 MediaCrawler CDP 本地浏览器桥接（推荐用于重度反爬平台）
对于小红书、知乎等在云服务器 IP 上极易触发风控/验证码的平台：
1. 在本地电脑使用 **MediaCrawler** 搭配 Chrome DevTools Protocol (**CDP**) 复用已登录的本地浏览器会话进行低频采集，避免云端 VPS 封号与风控。
2. 将采集结果导出为标准 RSS/Atom XML 或通过本地轻量 HTTP 服务暴露给本阅读器订阅。

---

## L1 / L2 / L3 信息降噪与知识库工作流

### 1. L1 关键词黑名单过滤 (Keyword Filters)
- 点击左侧栏 **Filters & Export**，添加关键词黑名单规则（如广告词、不感兴趣的营销号标签）。
- 每次刷新订阅源时，后端会自动执行 URL 规范化、去重及黑名单过滤，过滤掉的噪声条目不会进入阅读流。

### 2. L2 按需 AI 摘要 (On-Demand AI Summary)
- 在 `.env` 中配置 `GEMINI_API_KEY`（默认 `gemini-2.5-flash`）或 `OPENAI_API_KEY`（兼容 DeepSeek / OpenRouter / Ollama 等 OpenAI 协议服务）。
- 阅读文章时点击右侧栏 **AI Summary** 按需触发；结果自动缓存到 SQLite，二次查看零成本。

### 3. L3 批量打包导出至 NotebookLM 与 Obsidian
NotebookLM 免费版存在 **单个笔记本最多 50 个来源** 与 **单文件 50 万词** 的限制。为避免零散文章迅速耗尽 50 个来源额度，本工具提供 **Weekly Batch-Packed Markdown（按周批量打包）** 策略：
1. 日常阅读时将高价值内容标星（按 `s` 键收藏）。
2. 每周打开 **Filters & Export → Export to NotebookLM / Obsidian**，按 **收藏 / 视图 / 最近天数（默认 7 天）** 合并生成单份带 **Obsidian YAML Frontmatter** 的 Markdown 文件。
3. 界面会实时统计词数并对照 **400,000 词安全上限** 给出进度条提示（预留缓冲，稳妥低于 500k 限制）。
4. 可直接 **Download `.md`** 存入 Obsidian 知识库或手动上传至 NotebookLM；如果本地已安装并登录 [`nlm`](https://github.com/jacob-bd/notebooklm-mcp-cli) CLI，也可填入 `NOTEBOOKLM_DEFAULT_ID` 一键直推。

---

## 快捷键与安全设计 (Shortcuts & Security)

- **键盘快捷键**：`j` 下一篇 · `k` 上一篇 · `s` 收藏/取消收藏 · `m` 标记已读/未读 · `o` 打开原文
- **安全防护**：
  - 前端所有富文本与 Shownotes 均经 **DOMPurify** 严格清洗，防范 XSS。
  - 后端 `/api/image-proxy` 内置 **SSRF 防护**，解析并拒绝访问私网、回环 (`127.0.0.1`/`localhost`)、链路本地 (`169.254.169.254`) 及非 HTTP(S) 协议地址，并限制响应类型与大小。

---

## Phase 2：VPS 生产部署路线图 (`deploy/docker-compose.yml`)

当你希望 7×24 小时云端同步、多设备（移动端/桌面端）无缝访问时，可使用 [`deploy/docker-compose.yml`](deploy/docker-compose.yml) 在一台 2 vCPU / 4 GB RAM 的 VPS 上部署完整生产栈：

- **PostgreSQL 16 (`pgvector/pgvector:pg16`)**：持久化存储，预留向量检索扩展能力。
- **Miniflux (`miniflux/miniflux:latest`)**：高性能 Go RSS 引擎，已配置 `FETCHER_ALLOW_PRIVATE_NETWORKS=1`（支持内网拉取 RSSHub）与 `MEDIA_PROXY_MODE=all`（全局图片反防盗链代理）。
- **ReactFlux (`electh/reactflux:latest`)**：现代化的 Miniflux 响应式前端。
- **RSSHub + Redis 8 + Browserless Chromium**：社交源抓取三件套，为 Browserless Chromium 显式配置了 `mem_limit` 与 `shm_size`，防止无头浏览器 OOM 拖垮宿主机。
- **Cloudflare Tunnel (`cloudflare/cloudflared:latest`)**：Zero-Trust 加密穿透，宿主机无需对外开放任何 80/443 端口。

### 部署步骤
```bash
# 1. 在 deploy/ 目录下准备环境变量文件（参考根目录 .env.example 底部注释）
cp .env.example deploy/.env
# 编辑 deploy/.env，取消注释并填入 POSTGRES_PASSWORD、MINIFLUX_ADMIN_PASSWORD、
# BROWSERLESS_TOKEN、CLOUDFLARE_TUNNEL_TOKEN 等强随机密钥（切勿提交到 Git！）

# 2. 启动全部容器
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d

# 3. 在 Cloudflare Zero Trust Dashboard 中配置 Public Hostname 指向内网服务：
#    rss-api.yourdomain.com -> http://miniflux:8080
#    rss.yourdomain.com     -> http://reactflux:2000
```

---

## 目录结构 (Project Structure)

```text
rss_feed/
├── .github/
│   └── workflows/
│       └── ci.yml            # GitHub Actions 前后端 CI 流水线
├── backend/                  # FastAPI + SQLite 后端 (uv 管理)
├── frontend/                 # React + TypeScript + Tailwind 前端 (Vite)
├── deploy/
│   └── docker-compose.yml    # Phase 2 VPS 生产部署模板
├── .env.example              # 环境变量示例（无真实密钥）
├── .gitignore                # Git 忽略规则
├── justfile                  # install / dev / lint / test / build / check / clean
├── start.sh                  # 一键启动前后端脚本
├── VERSION                   # 语义化版本号 (0.3.0)
├── CHANGELOG.md              # 变更日志
└── README.md                 # 项目说明文档
```
