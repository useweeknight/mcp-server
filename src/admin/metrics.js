/**
 * Admin Metrics API
 *
 * 关键指标：Decision P50/P90、Hands-free rate、Sub success、Leftover 60%
 */

import { Router } from 'express';

const router = Router();

// =============================================================================
// GET /admin/metrics - 概览指标
// =============================================================================

router.get('/', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const supabase = req.supabase;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // 获取各种统计数据
    const [
      { count: activeUsersCount },
      { count: suggestionsCount },
      { data: leftovers },
      { data: signals }
    ] = await Promise.all([
      // 活跃用户数
      supabase
        .from('dinner_suggestions')
        .select('user_id', { count: 'exact', head: true })
        .gte('created_at', startDate.toISOString()),
      // 建议次数
      supabase
        .from('dinner_suggestions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startDate.toISOString()),
      // 剩菜数据
      supabase
        .from('leftovers')
        .select('*')
        .gte('created_at', startDate.toISOString()),
      // 信号数据
      supabase
        .from('recipe_signal')
        .select('*')
        .gte('created_at', startDate.toISOString())
    ]);

    // 计算剩菜消耗率
    const totalLeftovers = leftovers?.length || 0;
    const consumedLeftovers = leftovers?.filter(l => l.is_consumed).length || 0;
    const leftoverConsumptionRate = totalLeftovers > 0 
      ? (consumedLeftovers / totalLeftovers * 100).toFixed(1) 
      : 0;

    // 从 signals 计算完成率
    const cookStarts = signals?.filter(s => s.event_type === 'cook_start').length || 0;
    const cookCompletes = signals?.filter(s => s.event_type === 'cook_complete').length || 0;
    const completionRate = cookStarts > 0 
      ? (cookCompletes / cookStarts * 100).toFixed(1) 
      : 0;

    res.json({
      ok: true,
      data: {
        period_days: parseInt(days),
        overview: {
          active_users: activeUsersCount || 0,
          total_suggestions: suggestionsCount || 0,
          daily_suggestions_avg: suggestionsCount 
            ? (suggestionsCount / parseInt(days)).toFixed(1) 
            : 0
        },
        cooking: {
          cook_starts: cookStarts,
          cook_completes: cookCompletes,
          completion_rate: `${completionRate}%`
        },
        leftovers: {
          total: totalLeftovers,
          consumed: consumedLeftovers,
          consumption_rate: `${leftoverConsumptionRate}%`
        },
        // 预留指标（需要更多数据支持）
        performance: {
          decision_p50_ms: 'N/A',
          decision_p90_ms: 'N/A',
          hands_free_rate: 'N/A',
          substitution_success_rate: 'N/A'
        }
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/metrics/daily - 每日趋势
// =============================================================================

router.get('/daily', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const supabase = req.supabase;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // 获取每日建议数
    const { data: suggestions } = await supabase
      .from('dinner_suggestions')
      .select('created_at')
      .gte('created_at', startDate.toISOString());

    // 按日期分组
    const byDate = {};
    for (let i = 0; i < parseInt(days); i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      byDate[dateStr] = { suggestions: 0, cook_starts: 0, cook_completes: 0 };
    }

    (suggestions || []).forEach(s => {
      const date = s.created_at.split('T')[0];
      if (byDate[date]) {
        byDate[date].suggestions++;
      }
    });

    // 获取每日信号
    const { data: signals } = await supabase
      .from('recipe_signal')
      .select('event_type, created_at')
      .gte('created_at', startDate.toISOString())
      .in('event_type', ['cook_start', 'cook_complete']);

    (signals || []).forEach(s => {
      const date = s.created_at.split('T')[0];
      if (byDate[date]) {
        if (s.event_type === 'cook_start') byDate[date].cook_starts++;
        if (s.event_type === 'cook_complete') byDate[date].cook_completes++;
      }
    });

    // 转换为数组格式
    const trend = Object.entries(byDate)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      ok: true,
      data: {
        period_days: parseInt(days),
        trend
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/metrics/recipes - 菜谱热度
// =============================================================================

router.get('/recipes', async (req, res) => {
  try {
    const { days = 7, limit = 10 } = req.query;
    const supabase = req.supabase;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // 获取建议中的菜谱
    const { data: suggestions } = await supabase
      .from('dinner_suggestions')
      .select('recipe_id')
      .gte('created_at', startDate.toISOString())
      .not('recipe_id', 'is', null);

    // 统计菜谱出现次数
    const recipeCounts = {};
    (suggestions || []).forEach(s => {
      recipeCounts[s.recipe_id] = (recipeCounts[s.recipe_id] || 0) + 1;
    });

    // 排序并取 top N
    const topRecipeIds = Object.entries(recipeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, parseInt(limit))
      .map(([id]) => id);

    // 获取菜谱详情
    const { data: recipes } = await supabase
      .from('recipe')
      .select('id, title, title_zh, cook_type, time_total_min')
      .in('id', topRecipeIds);

    // 组合结果
    const topRecipes = topRecipeIds.map(id => {
      const recipe = recipes?.find(r => r.id === id);
      return {
        recipe_id: id,
        title: recipe?.title || 'Unknown',
        title_zh: recipe?.title_zh,
        cook_type: recipe?.cook_type,
        time_total_min: recipe?.time_total_min,
        suggestion_count: recipeCounts[id]
      };
    });

    res.json({
      ok: true,
      data: {
        period_days: parseInt(days),
        top_recipes: topRecipes
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

