# 项目启动与配置指南

本文档说明如何从零开始把 Curation App 跑起来。

---

## 项目结构

```
curation-app/
├── src/                  # React 前端（TypeScript + Tailwind）
│   ├── components/       # UI 组件
│   ├── lib/              # 工具库（auth、api 封装等）
│   └── App.tsx           # 主入口
├── server/               # FastAPI 后端（Python）
│   ├── routers/          # 路由模块
│   ├── database.py       # SQLite ORM
│   ├── auth.py           # JWT 验证与认证依赖
│   └── server.py         # FastAPI 主程序
├── src-tauri/            # Tauri 桌面壳（Rust）
└── docs/                 # 本目录：设计文档
```

**三个仓库协作：**
- `curation-app`（本仓库）：前端 + 后端服务
- `curation-data`（外部目录）：文章内容缓存、分析结果，路径通过 `CURATION_DATA_DIR` 指定
- `curation-agent`（外部仓库）：AI 分析 pipeline，路径通过 `CURATION_AGENT_REPO` 指定。Agent 根目录的 `manifest.yaml` 定义了可用的 stages 和 backends，server 从各版本 worktree 中动态读取

---

## 依赖安装

### 后端（Python 3.10+）

```bash
cd server
pip install -r requirements.txt
```

`requirements.txt` 包含：
- `fastapi` + `uvicorn` — Web 框架
- `python-jose[cryptography]` — JWT RS256 验证
- `httpx` — 异步 HTTP（用于拉取 JWKS）
- `beautifulsoup4` — HTML 解析
- `python-dotenv` — 加载 .env 文件

### 前端（Node.js 18+）

```bash
# 在项目根目录
npm install
```

---

## 环境变量配置

### 后端：`server/.env`

完整模板（参照 `server/.env.example`）：

```bash
# === 数据路径 ===
CURATION_DATA_DIR=/path/to/curation-data   # 文章和分析结果存储目录
CURATION_AGENT_REPO=/path/to/curation-agent # AI 分析 agent 的 git 仓库路径

# === 外部 API ===
DAJIALA_API_KEY=your_dajiala_api_key        # 大鲸鱼 API，用于拉取微信文章

# === Authing 认证 ===
AUTHING_APP_ID=你的AppID
AUTHING_ISSUER=https://your-app.authing.cn/oidc
AUTHING_JWKS_URI=https://your-app.authing.cn/oidc/.well-known/jwks.json

# === 管理员初始化注入（数据库初始化时自动写入）===
ADMIN_AUTHING_SUB=69c6267c2e8369d9bd4d037d
ADMIN_EMAIL=admin@example.com             # 可选
ADMIN_USERNAME=Admin                      # 可选

# === 安全密钥 ===
INVITE_SECRET=<32位以上随机字符串>
```

生成密钥：
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 前端：`.env`（项目根目录，和 `package.json` 同级）

```bash
VITE_AUTHING_APP_ID=你的AppID
VITE_AUTHING_DOMAIN=your-app.authing.cn       # 仅域名，不带 https://
VITE_AUTHING_REDIRECT_URI=tauri://localhost/auth/callback
```

本地开发时额外创建 `.env.development.local`（优先级更高，不提交 git）：

```bash
VITE_AUTHING_REDIRECT_URI=http://localhost:1420/auth/callback
```

---

## 启动后端

```bash
cd server
python server.py
```

后端默认监听 `0.0.0.0:8889`。

首次启动时会自动创建 SQLite 数据库（位于 `CURATION_DATA_DIR/articles.db`，若未设置则在 `server/articles.db`）。

**验证：**
```bash
curl http://localhost:8889/health
# 返回 {"status":"ok"}
```

---

## 启动前端（开发模式）

```bash
# 在项目根目录
npm run dev
```

访问 `http://localhost:1420`。

此时会看到登录界面（因为没有 token）。如果还没有配置 Authing，请先完成「首次部署」流程（见下）。

---

## 首次部署流程

> 完整的 Authing 配置步骤见 [`auth-system.md`](./auth-system.md)

简要顺序：

1. **配置 Authing**：创建 SPA 应用，填好回调 URL，关闭自助注册
2. **填写 .env 文件**（后端 + 前端）
3. **启动后端**
4. **配置管理员自动注入**：
   - 在后端 `.env` 设置 `ADMIN_AUTHING_SUB`（你当前为 `69c6267c2e8369d9bd4d037d`）
   - 启动后端时会在数据库初始化阶段自动创建/修复该管理员账号（幂等）
   - 可选填写 `ADMIN_EMAIL` 和 `ADMIN_USERNAME`
5. 管理员登录后，在「邀请码」面板生成邀请码分发给其他用户

---

## 常用命令

```bash
# 后端
python server.py                      # 启动后端（端口 8889）

# 前端
npm run dev                           # 开发服务器（端口 1420）
npm run build                         # 构建生产版本

# Tauri 桌面端
npm run tauri dev                     # 开发模式桌面窗口
npm run tauri build                   # 打包桌面应用
```

---

## 数据目录结构

`CURATION_DATA_DIR` 下的目录布局：

```
curation-data/
├── articles.db              # SQLite 数据库（所有元数据）
└── received_articles/       # 文章内容缓存
    └── {short_id}/          # 每篇文章一个子目录
        ├── article.md       # 清洗后的 Markdown 正文
        ├── article.html     # 原始 HTML（可选）
        └── meta.json        # 文章元信息
```

分析结果由 `curation-agent` 写入单独目录，路径在 `analysis_runs.workspace_path` 中记录。

---

## 多用户部署注意事项

目前 Curation App 设计为**个人/小团队**使用，后端部署后：

- 所有认证用户共享同一组订阅账号和文章库
- 分析任务全局共享队列
- 不同用户的阅读状态（`read_status`）未隔离（目前只有一个全局状态）

如果需要多用户隔离，需要在 `articles` 表增加用户维度的阅读状态记录，目前版本不支持。
