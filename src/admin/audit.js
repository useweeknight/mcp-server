/**
 * Admin Audit API
 *
 * 审计日志：变更轨迹、操作者、前后值
 */

import { Router } from 'express';

const router = Router();

// =============================================================================
// GET /admin/audit - 审计日志列表
// =============================================================================

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, entity, action, actor_user_id, days = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const supabase = req.supabase;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    let query = supabase
      .from('audit_logs')
      .select(`
        *,
        actor:users!actor_user_id(id, email, display_name)
      `, { count: 'exact' })
      .gte('created_at', startDate.toISOString());

    if (entity) {
      query = query.eq('entity', entity);
    }

    if (action) {
      query = query.eq('action', action);
    }

    if (actor_user_id) {
      query = query.eq('actor_user_id', actor_user_id);
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
// GET /admin/audit/:id - 审计日志详情
// =============================================================================

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.supabase;

    const { data, error } = await supabase
      .from('audit_logs')
      .select(`
        *,
        actor:users!actor_user_id(id, email, display_name)
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ ok: false, message: '审计日志不存在' });
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
// GET /admin/audit/stats - 审计统计
// =============================================================================

router.get('/stats/overview', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const supabase = req.supabase;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const { data: logs, count } = await supabase
      .from('audit_logs')
      .select('entity, action', { count: 'exact' })
      .gte('created_at', startDate.toISOString());

    // 按实体分组
    const byEntity = {};
    const byAction = {};
    (logs || []).forEach(log => {
      byEntity[log.entity] = (byEntity[log.entity] || 0) + 1;
      byAction[log.action] = (byAction[log.action] || 0) + 1;
    });

    res.json({
      ok: true,
      data: {
        period_days: parseInt(days),
        total: count || 0,
        by_entity: byEntity,
        by_action: byAction
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/audit/entity/:entity/:entityId - 查看某实体的变更历史
// =============================================================================

router.get('/entity/:entity/:entityId', async (req, res) => {
  try {
    const { entity, entityId } = req.params;
    const supabase = req.supabase;

    const { data, error } = await supabase
      .from('audit_logs')
      .select(`
        *,
        actor:users!actor_user_id(id, email, display_name)
      `)
      .eq('entity', entity)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    res.json({
      ok: true,
      data: data || [],
      entity,
      entity_id: entityId,
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

