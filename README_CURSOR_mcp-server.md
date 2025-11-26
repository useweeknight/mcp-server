# Weeknight · mcp-server · Cursor Context

Last updated: 2025-11-15

## 0) What this repo is

后端 Node/Express 服务，部署到 **Google Cloud Run（服务：mcp-core）**。
职责：对接 Supabase（Auth/Storage）、提供最小 API（含 `POST /generate-card`），
并启用**严格 CORS 白名单**。

---

## 1) Tech Stack & Entry

- Node 20 · Express（ESM，`package.json` 含 `"type":"module"`）
- 入口文件：`server.js`
- 关键路由：
  - `GET /` → 文本 `"Weeknight MCP server is up!"`
  - `GET /health` → `200 ok`（健康检查）
  - `GET /version` → 回显 `K_REVISION` 与时间
  - `POST /generate-card` → 接收 `image/png`，写入 Supabase Storage
    公有桶 `cards`，返回 public URL

---

## 2) Domains

- Cloud Run 基础域：`https://mcp-core-70953787995.us-central1.run.app`
- 自定义域（已完成）：`https://api.useweeknight.com`
- 前端（生产）：`https://app.useweeknight.com`
- 前端（预发）：`https://staging.useweeknight.com`
- Vercel 预览域：`https://app-web-tawny-zeta.vercel.app`
  （或通过 `CORS_ORIGINS` 追加）

---

## 3) CORS Policy (Strict Whitelist)

- `Access-Control-Allow-Origin`：仅放行
  - `https://app.useweeknight.com`
  - `https://staging.useweeknight.com`
  - `https://app-web-tawny-zeta.vercel.app`
  - 以及 `CORS_ORIGINS` 中的额外域（逗号分隔）
- `Access-Control-Allow-Methods`: `GET,POST,OPTIONS`
- `Access-Control-Allow-Headers`: `Content-Type, Authorization`
- 预检：`OPTIONS` 直接 `204`
- **凭据策略**：MVP 采用 **Bearer Token**（`Authorization: Bearer <token>`），
  **不**启用 `Allow-Credentials`。

**应用内中间件片段（已就位）**：

```js
const ENV_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = new Set([
  'https://app.useweeknight.com',
  'https://staging.useweeknight.com',
  'https://app-web-tawny-zeta.vercel.app',
  ...ENV_ORIGINS,
]);
app.use((req, res, next) => { /* see server.js */ });
```

---

## 4) Env Vars (.env) — Backend

| Key | Example | Where | Notes |
|---|---|---|---|
| `SUPABASE_URL` | `https://mvnjengmxzkrntyqubqe.supabase.co` | Cloud Run | 与前端一致 |
| `SUPABASE_SERVICE_ROLE_KEY` | `<supabase-service-role>` | Cloud Run (Secret) | 写入 Storage 等服务端操作 |
| `OPENAI_API_KEY` | `<openai-key>` | Cloud Run (Secret) | 预留 |
| `CORS_ORIGINS` | `https://preview-1.vercel.app,...` | Cloud Run | 追加 CORS 白名单 |
| `APPLE_TEAM_ID` | `48637KQ56K` | Cloud Run | — |
| `APPLE_KEY_ID` | `L366S7753W` | Cloud Run | — |
| `APPLE_BUNDLE_ID` | `com.useweeknight.app` | Cloud Run | — |
| `APPLE_SERVICES_ID` | `com.useweeknight.web` | Cloud Run | — |
| `APPLE_REDIRECT_URI` | `https://app.useweeknight.com/auth/callback/apple` | Cloud Run | — |

---

## 5) Service Accounts (GCP)

| SA Email | Purpose | Role |
|---|---|---|
| `mcp-deployer@trusty-matrix-474712-m4.iam.gserviceaccount.com` | GitHub Actions 部署 | `roles/run.admin` + Workload Identity User |
| `app-caller@trusty-matrix-474712-m4.iam.gserviceaccount.com` | 调用私有 Cloud Run | `roles/run.invoker`（服务级） |
| Runtime SA | 运行容器 | 包含 `roles/secretmanager.secretAccessor` |

---

## 6) Deployment

- 平台：**Cloud Run（us-central1） → 服务：mcp-core**
- 最小实例：开发=0，上线=1（按预算）
- 健康检查：HTTP `GET /health` 端口 `8080`
- 自定义域：`api.useweeknight.com`（CNAME→`ghs.googlehosted.com`）

### CI（示例步骤）

1. Build container image
2. `gcloud run deploy mcp-core --region us-central1 --image <image> --allow-unauthenticated=false`

---

## 7) Test (Copy/Paste)

### 预检（OPTIONS）

```bash
curl -i -X OPTIONS "https://mcp-core-70953787995.us-central1.run.app/health" \
  -H "Origin: https://staging.useweeknight.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type, Authorization"
```

### 实际请求（GET）

```bash
curl -i "https://mcp-core-70953787995.us-central1.run.app/health" \
  -H "Origin: https://app.useweeknight.com"
```

---

## 8) Frontend Call Pattern (Bearer Token)

```ts
const token = (await supabase.auth.getSession()).data.session?.access_token;
await fetch('https://api.useweeknight.com/generate-card?userId=USER_ID', {
  method: 'POST',
  headers: {
    'Content-Type': 'image/png',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  },
  body: pngBlob
});
```

---

## 9) Cursor Tips

- 打开：`server.js`、`Dockerfile`、`.github/workflows/*`、`README_CURSOR_mcp-server.md`
- 关键词检索：`/generate-card`、`CORS_ORIGINS`、`SUPABASE_SERVICE_ROLE_KEY`、`/health`
- 需要追加预览域时：只改 Cloud Run 环境变量 `CORS_ORIGINS`，无需改代码。
- 如需新增 Tonight / 菜谱相关 API 或 MCP 工具，务必以根目录
  `菜谱库_产品说明_v1.0.md` 与 `schema.sql` 里的
  recipe / recipe_step / recipe_media / nutrition_snapshot 等表为唯一数据源，
  不要在后端发明额外字段名。

更多统一的 Cursor 使用规范，见 ops-config/docs/CURSOR_HANDBOOK.md
