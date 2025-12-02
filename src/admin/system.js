/**
 * Admin System API
 *
 * 系统配置：环境、CORS 白名单、Feature Flags（只读）
 */

import { Router } from 'express';

const router = Router();

// =============================================================================
// GET /admin/system - 系统概览
// =============================================================================

router.get('/', async (req, res) => {
  try {
    res.json({
      ok: true,
      data: {
        environment: {
          node_version: process.version,
          node_env: process.env.NODE_ENV || 'development',
          revision: process.env.K_REVISION || 'local',
          region: process.env.K_REGION || 'unknown'
        },
        cors: {
          allowed_origins: [
            'https://app.useweeknight.com',
            'https://staging.useweeknight.com',
            ...(process.env.CORS_ORIGINS || '').split(',').filter(Boolean)
          ]
        },
        services: {
          supabase_url: process.env.SUPABASE_URL ? '已配置' : '未配置',
          openai: process.env.OPENAI_API_KEY ? '已配置' : '未配置'
        }
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/system/flags - Feature Flags（只读）
// =============================================================================

router.get('/flags', async (req, res) => {
  try {
    const supabase = req.supabase;

    const { data: flags, error } = await supabase
      .from('feature_flags')
      .select('*')
      .order('key', { ascending: true });

    if (error) {
      // 如果表不存在或查询失败，返回默认值
      return res.json({
        ok: true,
        data: {
          flags: [
            { key: 'cold_start_flow', is_enabled: true, description: '冷启动流程' },
            { key: 'emoji_feedback', is_enabled: true, description: '饭后 Emoji 反馈' },
            { key: 'autoplan', is_enabled: false, description: '自动规划' },
            { key: 'budget_learning', is_enabled: false, description: '预算学习' },
            { key: 'multi_channel_list', is_enabled: false, description: '多渠道清单' },
            { key: 'nutrition_weekly', is_enabled: false, description: '每周营养报告' },
            { key: 'ocr_import', is_enabled: true, description: 'OCR 导入' },
            { key: 'multi_dish_scheduler', is_enabled: false, description: '多菜调度器' },
            { key: 'appliance_link', is_enabled: false, description: '设备联动' }
          ],
          source: 'defaults'
        },
        trace_id: req.traceId
      });
    }

    res.json({
      ok: true,
      data: {
        flags: flags || [],
        source: 'database'
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/system/health - 健康检查详情
// =============================================================================

router.get('/health', async (req, res) => {
  try {
    const supabase = req.supabase;

    // 检查 Supabase 连接
    let supabaseStatus = 'unknown';
    try {
      const { error } = await supabase.from('users').select('id').limit(1);
      supabaseStatus = error ? 'error' : 'healthy';
    } catch {
      supabaseStatus = 'error';
    }

    res.json({
      ok: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB'
        },
        services: {
          supabase: supabaseStatus
        }
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

