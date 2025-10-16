// server.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';

// Cloud Run 注入的环境变量（通过 Secret Manager 绑定）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const app = express();

// 上传接口：接收 PNG 二进制并写入 Supabase Storage 的 cards 桶
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
          upsert: true
        });

      if (error) throw error;

      // Public bucket 的公开直链
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/cards/${path}`;
      return res.json({ ok: true, url: publicUrl });
    } catch (e) {
      return res
        .status(500)
        .json({ ok: false, message: e?.message || String(e) });
    }
  }
);

// 健康检查
app.get('/healthz', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
