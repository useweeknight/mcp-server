/**
 * Leftovers API 路由
 *
 * 剩菜管理：创建、查询、标记消费
 * 按产品书要求：烹饪后标记"吃光/剩1份/剩2+"
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';

const router = Router();

// =============================================================================
// POST /api/leftovers - 创建剩菜记录
// =============================================================================

/**
 * 创建剩菜记录
 *
 * @route POST /api/leftovers
 * @body {Object} - 剩菜信息
 * @body {string} recipe_id - 菜谱 ID
 * @body {string} recipe_title - 菜谱标题
 * @body {number} servings - 剩余份数 (1, 2, 3...)
 * @body {string} [user_id] - 用户 ID
 * @body {string} [household_id] - 家庭 ID
 * @body {number} [safe_hours] - 安全保存时长（小时），默认 72
 * @body {string} [transformation] - 改造建议
 */
router.post('/', async (req, res) => {
  try {
    const {
      recipe_id,
      recipe_title,
      servings,
      user_id,
      household_id,
      safe_hours = 72,
      transformation
    } = req.body;

    // 参数校验
    if (!recipe_id) {
      return res.status(400).json({
        ok: false,
        message: 'Missing recipe_id',
        trace_id: req.traceId
      });
    }

    if (!servings || servings < 1) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid servings (must be >= 1)',
        trace_id: req.traceId
      });
    }

    const supabase = req.supabase;
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        message: 'Supabase client not available',
        trace_id: req.traceId
      });
    }

    // 获取用户的 household_id（如果未提供）
    let effectiveHouseholdId = household_id;
    if (!effectiveHouseholdId && user_id) {
      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user_id)
        .limit(1)
        .single();
      effectiveHouseholdId = membership?.household_id;
    }

    // 计算安全保存截止时间
    // 产品书：海鲜/凉拌 ≤48h；熟肉/汤 ≤72h
    const safeUntil = new Date();
    safeUntil.setHours(safeUntil.getHours() + safe_hours);

    // 创建剩菜记录
    const newLeftover = {
      id: randomUUID(),
      household_id: effectiveHouseholdId,
      recipe_id,
      recipe_title: recipe_title || null,
      servings,
      safe_until: safeUntil.toISOString(),
      transformation: transformation || null,
      is_consumed: false,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('leftovers')
      .insert(newLeftover)
      .select()
      .single();

    if (error) {
      console.error('[leftovers] Create error:', error);
      return res.status(500).json({
        ok: false,
        message: error.message,
        trace_id: req.traceId
      });
    }

    // 记录到 audit_logs
    if (user_id) {
      await supabase.from('audit_logs').insert({
        actor_user_id: user_id,
        entity: 'leftovers',
        entity_id: data.id,
        action: 'create',
        before_value: null,
        after_value: data
      });
    }

    res.status(201).json({
      ok: true,
      data,
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[leftovers] POST error:', error);
    res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// GET /api/leftovers - 获取剩菜列表
// =============================================================================

/**
 * 获取剩菜列表
 *
 * @route GET /api/leftovers
 * @query {string} [user_id] - 用户 ID
 * @query {string} [household_id] - 家庭 ID
 * @query {boolean} [include_consumed] - 是否包含已消费的（默认 false）
 * @query {boolean} [include_expired] - 是否包含已过期的（默认 false）
 */
router.get('/', async (req, res) => {
  try {
    const {
      user_id,
      household_id,
      include_consumed = 'false',
      include_expired = 'false'
    } = req.query;

    const supabase = req.supabase;
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        message: 'Supabase client not available',
        trace_id: req.traceId
      });
    }

    // 获取用户的 household_id（如果未提供）
    let effectiveHouseholdId = household_id;
    if (!effectiveHouseholdId && user_id) {
      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user_id)
        .limit(1)
        .single();
      effectiveHouseholdId = membership?.household_id;
    }

    // 构建查询
    let query = supabase
      .from('leftovers')
      .select('*')
      .order('created_at', { ascending: false });

    if (effectiveHouseholdId) {
      query = query.eq('household_id', effectiveHouseholdId);
    }

    // 过滤已消费
    if (include_consumed !== 'true') {
      query = query.eq('is_consumed', false);
    }

    // 过滤已过期
    if (include_expired !== 'true') {
      query = query.gte('safe_until', new Date().toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('[leftovers] GET error:', error);
      return res.status(500).json({
        ok: false,
        message: error.message,
        trace_id: req.traceId
      });
    }

    res.json({
      ok: true,
      data: data || [],
      total: data?.length || 0,
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[leftovers] GET error:', error);
    res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// PUT /api/leftovers/:id/consume - 标记剩菜已消费
// =============================================================================

/**
 * 标记剩菜已消费（支持幂等）
 *
 * @route PUT /api/leftovers/:id/consume
 * @param {string} id - 剩菜记录 ID
 * @body {string} [user_id] - 操作用户 ID
 * @body {string} [idempotency_key] - 幂等键
 */
router.put('/:id/consume', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, idempotency_key } = req.body;

    const supabase = req.supabase;
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        message: 'Supabase client not available',
        trace_id: req.traceId
      });
    }

    // 检查幂等键（如果提供）
    if (idempotency_key) {
      const { data: existing } = await supabase
        .from('compensation_log')
        .select('id')
        .eq('idempotency_key', idempotency_key)
        .eq('tool', 'leftovers.consume')
        .single();

      if (existing) {
        // 已处理过，返回成功
        const { data: leftover } = await supabase
          .from('leftovers')
          .select('*')
          .eq('id', id)
          .single();

        return res.json({
          ok: true,
          data: leftover,
          message: 'Already processed (idempotent)',
          trace_id: req.traceId
        });
      }
    }

    // 获取当前记录
    const { data: before, error: fetchError } = await supabase
      .from('leftovers')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !before) {
      return res.status(404).json({
        ok: false,
        message: 'Leftover not found',
        trace_id: req.traceId
      });
    }

    // 如果已经消费，返回成功（幂等）
    if (before.is_consumed) {
      return res.json({
        ok: true,
        data: before,
        message: 'Already consumed',
        trace_id: req.traceId
      });
    }

    // 更新为已消费
    const { data, error } = await supabase
      .from('leftovers')
      .update({
        is_consumed: true,
        consumed_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[leftovers] Consume error:', error);
      return res.status(500).json({
        ok: false,
        message: error.message,
        trace_id: req.traceId
      });
    }

    // 记录到 compensation_log
    await supabase.from('compensation_log').insert({
      user_id: user_id || null,
      household_id: before.household_id,
      tool: 'leftovers.consume',
      operation: 'UPDATE',
      entity_type: 'leftovers',
      entity_id: id,
      before_snapshot: before,
      after_snapshot: data,
      idempotency_key: idempotency_key || randomUUID()
    });

    // 记录到 audit_logs
    if (user_id) {
      await supabase.from('audit_logs').insert({
        actor_user_id: user_id,
        entity: 'leftovers',
        entity_id: id,
        action: 'consume',
        before_value: before,
        after_value: data
      });
    }

    res.json({
      ok: true,
      data,
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[leftovers] PUT consume error:', error);
    res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: req.traceId
    });
  }
});

export default router;

