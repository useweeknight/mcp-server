/**
 * Weeknight MCP Server
 *
 * 后端 Node/Express 服务，部署到 Google Cloud Run。
 * 职责：
 * - 对接 Supabase（Auth/Storage）
 * - 提供 MCP 工具集
 * - Tonight 主链路 API
 * - Recipes REST API
 * - Telemetry 埋点
 * - 观测指标
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';

// 中间件
import { traceIdMiddleware } from './src/middleware/traceId.js';
import { metricsMiddleware, metricsHandler } from './src/middleware/metrics.js';

// 路由
import tonightRouter from './src/routes/tonight.js';
import recipesRouter from './src/routes/recipes.js';
import telemetryRouter from './src/routes/telemetry.js';
import realtimeRouter from './src/routes/realtime.js';
import pantryRouter from './src/routes/pantry.js';

// =============================================================================
// 环境变量
// =============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 开发环境允许无 Supabase 启动（用于测试）
const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  if (!isDev) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  } else {
    console.warn('[DEV] Running without Supabase credentials');
  }
}

// =============================================================================
// Supabase 客户端
// =============================================================================

const supabase = SUPABASE_URL && SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE)
  : null;

// =============================================================================
// Express App
// =============================================================================

const app = express();

// =============================================================================
// CORS（严格白名单）
// =============================================================================

const ENV_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set([
  // 生产
  'https://app.useweeknight.com',
  // Staging
  'https://staging.useweeknight.com',
  // 当前 Vercel 预览域
  'https://app-web-tawny-zeta.vercel.app',
  ...ENV_ORIGINS,
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trace-Id');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// =============================================================================
// 全局中间件
// =============================================================================

// Trace ID
app.use(traceIdMiddleware);

// Metrics 收集
app.use(metricsMiddleware);

// JSON body parser
app.use(express.json({ limit: '1mb' }));

// Supabase 客户端注入
app.use((req, _res, next) => {
  req.supabase = supabase;
  next();
});

// 请求日志
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} trace=${req.traceId}`);
  next();
});

// =============================================================================
// 基础路由
// =============================================================================

// 根路径
app.get('/', (_req, res) => {
  res.send('Weeknight MCP server is up!\n');
});

// ==== 健康检查（Cloud Run 探活用）====
app.get('/health', (_req, res) => res.status(200).send('ok'));

// 版本信息
app.get('/version', (_req, res) => {
  res.json({
    revision: process.env.K_REVISION || 'unknown',
    time: new Date().toISOString(),
    node: process.version
  });
});

// Metrics 端点
app.get('/metrics', metricsHandler);

// =============================================================================
// 业务路由
// =============================================================================

// Tonight 主链路
app.use('/api/tonight', tonightRouter);

// Realtime Token API (Step 6)
app.use('/api/realtime', realtimeRouter);

// Pantry OCR API (Step 6)
app.use('/api/pantry', pantryRouter);

// Recipes REST API
app.use('/recipes', recipesRouter);

// Telemetry 埋点
app.use('/telemetry', telemetryRouter);

// =============================================================================
// 上传接口（保留原有功能）
// =============================================================================

app.post(
  '/generate-card',
  express.raw({ type: 'image/png', limit: '6mb' }),
  async (req, res) => {
    try {
      if (!req.body || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ ok: false, message: 'No PNG body' });
      }

      if (!supabase) {
        return res.status(500).json({ ok: false, message: 'Supabase not configured' });
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

// =============================================================================
// 404 处理
// =============================================================================

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    message: 'Not found'
  });
});

// =============================================================================
// 错误处理
// =============================================================================

app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.url}:`, err);
  res.status(500).json({
    ok: false,
    message: err.message || 'Internal server error',
    trace_id: req.traceId
  });
});

// =============================================================================
// 启动服务器
// =============================================================================

const PORT = process.env.PORT || 8080;

// 只在非测试环境下启动监听
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
  });
}

// 导出 app 供测试使用
export { app, supabase };
export default app;
