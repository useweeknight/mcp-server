/**
 * Admin API 路由入口
 *
 * 挂载所有 /admin/* 子路由
 * 所有 Admin API 都需要通过 adminAuthMiddleware 校验
 */

import { Router } from 'express';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

// Admin 子路由
import usersRouter from './users.js';
import recipesRouter from './recipes.js';
import substitutionsRouter from './substitutions.js';
import pantryRouter from './pantry.js';
import leftoversRouter from './leftovers.js';
import suggestionsRouter from './suggestions.js';
import flagsRouter from './flags.js';  // 内容标签/风险标签
import metricsRouter from './metrics.js';
import systemRouter from './system.js';
import auditRouter from './audit.js';

const router = Router();

// 所有 Admin 路由都需要角色验证
router.use(adminAuthMiddleware);

// 挂载子路由
router.use('/users', usersRouter);
router.use('/recipes', recipesRouter);
router.use('/substitutions', substitutionsRouter);
router.use('/pantry', pantryRouter);
router.use('/leftovers', leftoversRouter);
router.use('/suggestions', suggestionsRouter);
router.use('/flags', flagsRouter);      // 内容标签/风险标签（非 feature_flags）
router.use('/metrics', metricsRouter);
router.use('/system', systemRouter);
router.use('/audit', auditRouter);

// Admin 概览（Dashboard 数据）
router.get('/', async (req, res) => {
  try {
    const supabase = req.supabase;

    // 获取今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const [
      { count: todayActiveUsers },
      { count: todaySuggestions },
      { count: todayCookCompletes },
      { count: todayLeftoverMarks }
    ] = await Promise.all([
      // 今日活跃用户
      supabase
        .from('dinner_suggestions')
        .select('user_id', { count: 'exact', head: true })
        .gte('created_at', todayISO),
      // 今日建议次数
      supabase
        .from('dinner_suggestions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayISO),
      // 今日完成烹饪
      supabase
        .from('recipe_signal')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'cook_complete')
        .gte('created_at', todayISO),
      // 今日剩菜标记
      supabase
        .from('leftovers')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayISO)
    ]);

    // 获取 7 天剩菜消耗率
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { data: weekLeftovers } = await supabase
      .from('leftovers')
      .select('*')
      .gte('created_at', weekAgo.toISOString());

    const totalLeftovers = weekLeftovers?.length || 0;
    const consumedIn72h = weekLeftovers?.filter(l => {
      if (!l.is_consumed || !l.consumed_at) return false;
      const created = new Date(l.created_at);
      const consumedAt = new Date(l.consumed_at);
      const hoursElapsed = (consumedAt - created) / (1000 * 60 * 60);
      return hoursElapsed <= 72;
    }).length || 0;

    res.json({
      ok: true,
      data: {
        today: {
          active_users: todayActiveUsers || 0,
          suggestions: todaySuggestions || 0,
          cook_completes: todayCookCompletes || 0,
          leftover_marks: todayLeftoverMarks || 0
        },
        week: {
          leftover_consumption_rate_72h: totalLeftovers > 0 
            ? `${(consumedIn72h / totalLeftovers * 100).toFixed(1)}%` 
            : 'N/A',
          total_leftovers: totalLeftovers
        },
        admin_user: {
          id: req.adminUser.id,
          email: req.adminUser.email,
          role: req.adminUser.role
        }
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

