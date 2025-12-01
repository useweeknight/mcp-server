/**
 * Admin Suggestions API
 *
 * 晚餐建议日志：查看、筛选、导出
 */

import { Router } from 'express';

const router = Router();

// =============================================================================
// GET /admin/suggestions - 建议列表
// =============================================================================

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, user_id, recipe_id, days = 7 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const supabase = req.supabase;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    let query = supabase
      .from('dinner_suggestions')
      .select(`
        *,
        users(id, email, display_name),
        recipe(id, title, title_zh)
      `, { count: 'exact' })
      .gte('created_at', startDate.toISOString());

    if (user_id) {
      query = query.eq('user_id', user_id);
    }

    if (recipe_id) {
      query = query.eq('recipe_id', recipe_id);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    res.json({
      ok: true,
      data: data || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      period_days: parseInt(days),
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/suggestions/:id - 建议详情（含 DSL、候选、规则）
// =============================================================================

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.supabase;

    const { data, error } = await supabase
      .from('dinner_suggestions')
      .select(`
        *,
        users(id, email, display_name),
        recipe(id, title, title_zh, cook_type, equipment, time_total_min)
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ ok: false, message: '建议记录不存在' });
    }

    res.json({
      ok: true,
      data,
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/suggestions/:id/export - 导出单条（JSON）
// =============================================================================

router.get('/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.supabase;

    const { data, error } = await supabase
      .from('dinner_suggestions')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ ok: false, message: '建议记录不存在' });
    }

    // 设置下载头
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=suggestion-${id}.json`);

    res.json(data);
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/suggestions/stats/overview - 建议统计
// =============================================================================

router.get('/stats/overview', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const supabase = req.supabase;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // 获取时间段内的建议
    const { data: suggestions, count } = await supabase
      .from('dinner_suggestions')
      .select('*', { count: 'exact' })
      .gte('created_at', startDate.toISOString());

    // 按日期分组
    const byDate = {};
    (suggestions || []).forEach(s => {
      const date = s.created_at.split('T')[0];
      byDate[date] = (byDate[date] || 0) + 1;
    });

    // 使用剩菜的建议
    const withLeftover = (suggestions || []).filter(s => 
      s.meta?.leftover_use_flag || s.leftover_use_flag
    ).length;

    res.json({
      ok: true,
      data: {
        period_days: parseInt(days),
        total: count || 0,
        daily_average: count ? (count / parseInt(days)).toFixed(1) : 0,
        with_leftover: withLeftover,
        leftover_rate: count > 0 ? (withLeftover / count * 100).toFixed(1) : 0,
        by_date: byDate
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

