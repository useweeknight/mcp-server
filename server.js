// server.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';

// ==== 环境变量（Cloud Run 通过 Secret Manager/环境配置注入）====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ==== Supabase 客户端（service_role 用于受控服务端写入）====
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const app = express();

// ==== CORS（仅允许前端域名；支持通过 CORS_ORIGINS 追加）====
const ENV_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set([
  // 生产
  'https://app.useweeknight.com',
  // Staging
  'https://staging.useweeknight.com',
  // 当前 vercel 预览域（如有新的就放到 CORS_ORIGINS 环境变量里）
  'https://app-web-tawny-zeta.vercel.app',
  ...ENV_ORIGINS,
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    // 如需携带 Cookie/Session 或浏览器自动带 Authorization：
    // res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ==== （可选）请求日志，便于在 Cloud Run 日志中确认路由是否被打到 ====
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// ==== 根路径（快速人肉自测用）====
app.get('/', (_req, res) => {
  res.send('Weeknight MCP server is up!\n');
});

// ==== 健康检查（监控/脚本/探活用）====
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));
// ==== （可选）版本回显（Cloud Run 注入 K_REVISION）====
app.get('/version', (_req, res) => {
  res.json({
    revision: process.env.K_REVISION || 'unknown',
    time: new Date().toISOString(),
  });
});

// ==== 上传接口：接收 PNG 二进制写入 Supabase Storage 的 cards 桶 ====
app.post(
  '/generate-card',
  express.raw({ type: 'image/png', limit: '6mb' }),
  async (req, res) => {
    try {
      if (!req.body || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ ok: false, message: 'No PNG body' });
      }

      const userId = String(req.query.userId || 'anon');
      const path = `users/${userId}/card-${Date.now()}.png`;

      const { error } = await supabase.storage
        .from('cards')
        .upload(path, req.body, {
          contentType: 'image/png',
          cacheControl: '31536000',
          upsert: true,
        });

      if (error) throw error;

      // Public bucket 的公开直链
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/cards/${path}`;
      return res.json({ ok: true, url: publicUrl });
    } catch (e) {
      console.error('upload failed:', e);
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  }
);

// ==== 启动 ====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
