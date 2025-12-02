/**
 * Admin Leftovers API
 *
 * 剩菜管理：按用户/家庭查看、时效核对、建议跟进
 */

import { Router } from 'express';
import { requireRole } from '../middleware/adminAuth.js';

const router = Router();

// =============================================================================
// GET /admin/leftovers - 剩菜列表
// =============================================================================

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, household_id, expired_only, consumed } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const supabase = req.supabase;

    let query = supabase
      .from('leftovers')
      .select(`
        *,
        households(id, name),
        recipe(id, title, title_zh)
      `, { count: 'exact' });

    if (household_id) {
      query = query.eq('household_id', household_id);
    }

    if (expired_only === 'true') {
      query = query.lte('safe_until', new Date().toISOString());
    }

    if (consumed !== undefined) {
      query = query.eq('is_consumed', consumed === 'true');
    }

    const { data, count, error } = await query
      .order('safe_until', { ascending: true })
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
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/leftovers/household/:householdId - 按家庭查看剩菜
// =============================================================================

router.get('/household/:householdId', async (req, res) => {
  try {
    const { householdId } = req.params;
    const supabase = req.supabase;

    // 获取家庭信息
    const { data: household } = await supabase
      .from('households')
      .select('*')
      .eq('id', householdId)
      .single();

    if (!household) {
      return res.status(404).json({ ok: false, message: '家庭不存在' });
    }

    // 获取剩菜
    const { data: items, error } = await supabase
      .from('leftovers')
      .select(`
        *,
        recipe(id, title, title_zh)
      `)
      .eq('household_id', householdId)
      .order('safe_until', { ascending: true });

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 统计
    const now = new Date();
    const stats = {
      total: items?.length || 0,
      consumed: items?.filter(i => i.is_consumed).length || 0,
      expired: items?.filter(i => !i.is_consumed && new Date(i.safe_until) < now).length || 0,
      active: items?.filter(i => !i.is_consumed && new Date(i.safe_until) >= now).length || 0
    };

    res.json({
      ok: true,
      data: {
        household,
        items: items || [],
        stats
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// PUT /admin/leftovers/:id - 更新剩菜
// =============================================================================

router.put('/:id', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const { servings, safe_until, note, is_consumed } = req.body;
    const supabase = req.supabase;

    // 获取修改前的值
    const { data: before } = await supabase
      .from('leftovers')
      .select('*')
      .eq('id', id)
      .single();

    if (!before) {
      return res.status(404).json({ ok: false, message: '剩菜记录不存在' });
    }

    const updates = {};
    if (servings !== undefined) updates.servings = servings;
    if (safe_until !== undefined) updates.safe_until = safe_until;
    if (note !== undefined) updates.note = note;
    if (is_consumed !== undefined) {
      updates.is_consumed = is_consumed;
      if (is_consumed) {
        updates.consumed_at = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from('leftovers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 写入审计日志
    await supabase.from('audit_logs').insert({
      actor_user_id: req.adminUser.id,
      entity: 'leftovers',
      entity_id: id,
      action: 'update',
      before_value: before,
      after_value: data
    });

    res.json({ ok: true, data, trace_id: req.traceId });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/leftovers/stats - 剩菜统计（消耗率等）
// =============================================================================

router.get('/stats/overview', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const supabase = req.supabase;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // 获取时间段内的剩菜
    const { data: leftovers } = await supabase
      .from('leftovers')
      .select('*')
      .gte('created_at', startDate.toISOString());

    const total = leftovers?.length || 0;
    const consumed = leftovers?.filter(l => l.is_consumed).length || 0;
    const expired = leftovers?.filter(l => !l.is_consumed && new Date(l.safe_until) < new Date()).length || 0;

    // 48-72h 内消耗率
    const consumedIn48h = leftovers?.filter(l => {
      if (!l.is_consumed || !l.consumed_at) return false;
      const created = new Date(l.created_at);
      const consumedAt = new Date(l.consumed_at);
      const hoursElapsed = (consumedAt - created) / (1000 * 60 * 60);
      return hoursElapsed <= 48;
    }).length || 0;

    const consumedIn72h = leftovers?.filter(l => {
      if (!l.is_consumed || !l.consumed_at) return false;
      const created = new Date(l.created_at);
      const consumedAt = new Date(l.consumed_at);
      const hoursElapsed = (consumedAt - created) / (1000 * 60 * 60);
      return hoursElapsed <= 72;
    }).length || 0;

    res.json({
      ok: true,
      data: {
        period_days: parseInt(days),
        total,
        consumed,
        expired,
        consumption_rate: total > 0 ? (consumed / total * 100).toFixed(1) : 0,
        consumption_rate_48h: total > 0 ? (consumedIn48h / total * 100).toFixed(1) : 0,
        consumption_rate_72h: total > 0 ? (consumedIn72h / total * 100).toFixed(1) : 0
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

