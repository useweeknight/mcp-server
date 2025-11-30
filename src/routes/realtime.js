/**
 * Realtime API 路由
 *
 * POST /api/realtime/token - 生成 Realtime session 的短期 token
 *
 * 客户端使用这个 token 直接连接 OpenAI Realtime WebSocket。
 */

import { Router } from 'express';
import { createRealtimeSession, getVisionEnabledConfig } from '../realtime/client.js';
import { recordSchemaViolation } from '../middleware/metrics.js';

const router = Router();

// =============================================================================
// POST /api/realtime/token
// =============================================================================

/**
 * 生成 Realtime session token
 *
 * @route POST /api/realtime/token
 * @body {Object}
 * @body.userId {string} - 用户 ID
 * @body.visionEnabled {boolean} - 是否启用视觉模态（可选）
 * @returns {{ ok: boolean, token: string, model: string, expiresAt: string, wsUrl: string }}
 */
router.post('/token', async (req, res) => {
  const traceId = req.traceId;

  try {
    const { userId, visionEnabled } = req.body;

    // 验证 userId
    if (!userId) {
      recordSchemaViolation('/api/realtime/token');
      return res.status(400).json({
        ok: false,
        message: 'Missing userId',
        trace_id: traceId
      });
    }

    const supabase = req.supabase;

    // 验证用户存在（如果 Supabase 可用）
    if (supabase) {
      const { data: user, error } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .single();

      if (error || !user) {
        console.warn(`[Realtime] User not found: ${userId}`);
        // 不阻止请求，允许匿名使用（开发阶段）
      }
    }

    // 获取 session 配置
    const sessionConfig = visionEnabled ? getVisionEnabledConfig() : {};

    // 创建 Realtime session
    const session = await createRealtimeSession({
      userId,
      sessionConfig
    });

    console.log(`[Realtime] Token generated for user=${userId}, expires=${session.expiresAt}`);

    return res.json({
      ok: true,
      token: session.token,
      model: session.model,
      expiresAt: session.expiresAt,
      wsUrl: session.wsUrl,
      trace_id: traceId
    });

  } catch (error) {
    console.error('[Realtime] Error generating token:', error);

    return res.status(500).json({
      ok: false,
      message: error.message || 'Failed to generate Realtime token',
      trace_id: traceId
    });
  }
});

// =============================================================================
// GET /api/realtime/config
// =============================================================================

/**
 * 获取 Realtime 配置信息（用于客户端调试）
 *
 * @route GET /api/realtime/config
 */
router.get('/config', (_req, res) => {
  res.json({
    ok: true,
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
    supportedModalities: ['text', 'audio'],
    voiceCommands: [
      'start',
      'next',
      'repeat',
      'pause',
      '+1min',
      'set N minutes',
      'panic fix'
    ],
    wsEndpoint: 'wss://api.openai.com/v1/realtime'
  });
});

export default router;

