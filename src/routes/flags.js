/**
 * Feature Flags API 路由
 *
 * 只读接口，从 feature_flags 表读取功能开关
 * 至少包含：cold_start_flow、emoji_feedback
 */

import { Router } from 'express';

const router = Router();

// =============================================================================
// 默认 flags（当数据库无数据时的回退值）
// =============================================================================

const DEFAULT_FLAGS = {
  cold_start_flow: true,
  emoji_feedback: true,
  autoplan: false,
  budget_learning: false,
  multi_channel_list: false,
  nutrition_weekly: false,
  ocr_import: true,
  multi_dish_scheduler: false,
  appliance_link: false,
  web_voice_experiment: false
};

// =============================================================================
// GET /api/flags - 获取所有功能开关
// =============================================================================

/**
 * 获取功能开关列表
 *
 * @route GET /api/flags
 * @query {string} [user_id] - 用户 ID（用于个性化开关）
 * @query {string} [keys] - 逗号分隔的开关名列表（仅返回指定开关）
 * @returns {Object} flags - 功能开关键值对
 */
router.get('/', async (req, res) => {
  try {
    const { user_id, keys } = req.query;
    const requestedKeys = keys ? keys.split(',').map(k => k.trim()) : null;

    const supabase = req.supabase;

    // 如果没有 Supabase 客户端，返回默认值
    if (!supabase) {
      console.warn('[flags] No Supabase client, returning defaults');
      let flags = { ...DEFAULT_FLAGS };

      if (requestedKeys) {
        flags = Object.fromEntries(
          Object.entries(flags).filter(([k]) => requestedKeys.includes(k))
        );
      }

      return res.json({
        ok: true,
        flags,
        source: 'defaults',
        trace_id: req.traceId
      });
    }

    // 从数据库读取 flags
    let query = supabase
      .from('feature_flags')
      .select('key, value, description, is_enabled');

    if (requestedKeys && requestedKeys.length > 0) {
      query = query.in('key', requestedKeys);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[flags] Query error:', error);
      // 返回默认值
      return res.json({
        ok: true,
        flags: DEFAULT_FLAGS,
        source: 'defaults',
        error: error.message,
        trace_id: req.traceId
      });
    }

    // 将数组转换为键值对
    const dbFlags = {};
    (data || []).forEach(row => {
      // value 可能是布尔或 JSON
      let val = row.value;
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {
          // 保持原值
        }
      }
      // 如果有 is_enabled 字段，用它覆盖
      dbFlags[row.key] = row.is_enabled !== undefined ? row.is_enabled : val;
    });

    // 合并默认值和数据库值
    const flags = { ...DEFAULT_FLAGS, ...dbFlags };

    // 如果指定了 keys，只返回请求的
    let result = flags;
    if (requestedKeys) {
      result = Object.fromEntries(
        Object.entries(flags).filter(([k]) => requestedKeys.includes(k))
      );
    }

    res.json({
      ok: true,
      flags: result,
      source: 'database',
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[flags] GET error:', error);
    res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      flags: DEFAULT_FLAGS,
      source: 'defaults',
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// GET /api/flags/:key - 获取单个功能开关
// =============================================================================

/**
 * 获取单个功能开关
 *
 * @route GET /api/flags/:key
 * @param {string} key - 开关名
 * @returns {Object} { key, value, enabled }
 */
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;

    const supabase = req.supabase;

    // 如果没有 Supabase 客户端，返回默认值
    if (!supabase) {
      const defaultValue = DEFAULT_FLAGS[key];
      return res.json({
        ok: true,
        key,
        value: defaultValue !== undefined ? defaultValue : false,
        enabled: defaultValue !== undefined ? defaultValue : false,
        source: 'defaults',
        trace_id: req.traceId
      });
    }

    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .eq('key', key)
      .single();

    if (error || !data) {
      // 返回默认值
      const defaultValue = DEFAULT_FLAGS[key];
      return res.json({
        ok: true,
        key,
        value: defaultValue !== undefined ? defaultValue : false,
        enabled: defaultValue !== undefined ? defaultValue : false,
        source: 'defaults',
        trace_id: req.traceId
      });
    }

    res.json({
      ok: true,
      key: data.key,
      value: data.value,
      enabled: data.is_enabled !== undefined ? data.is_enabled : data.value,
      description: data.description,
      source: 'database',
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[flags] GET /:key error:', error);
    res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: req.traceId
    });
  }
});

export default router;

