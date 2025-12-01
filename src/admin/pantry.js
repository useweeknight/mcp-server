/**
 * Admin Pantry API
 *
 * 库存管理：按用户/家庭查看、校准、批量清理
 */

import { Router } from 'express';
import { requireRole } from '../middleware/adminAuth.js';

const router = Router();

// =============================================================================
// GET /admin/pantry - 库存列表（支持按家庭筛选）
// =============================================================================

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, household_id, search, expired_only } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const supabase = req.supabase;

    let query = supabase
      .from('pantry_items')
      .select(`
        *,
        households(id, name)
      `, { count: 'exact' });

    if (household_id) {
      query = query.eq('household_id', household_id);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    if (expired_only === 'true') {
      query = query.lte('expire_on', new Date().toISOString().split('T')[0]);
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
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// GET /admin/pantry/household/:householdId - 按家庭查看库存
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

    // 获取库存
    const { data: items, error } = await supabase
      .from('pantry_items')
      .select('*')
      .eq('household_id', householdId)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 统计
    const now = new Date();
    const stats = {
      total_items: items?.length || 0,
      expired_items: items?.filter(i => i.expire_on && new Date(i.expire_on) < now).length || 0,
      by_category: {}
    };

    (items || []).forEach(item => {
      const cat = item.category || '未分类';
      stats.by_category[cat] = (stats.by_category[cat] || 0) + 1;
    });

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
// PUT /admin/pantry/:id - 校准库存项
// =============================================================================

router.put('/:id', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const { qty_est_lower, qty_est_upper, unit, expire_on, note } = req.body;
    const supabase = req.supabase;

    // 获取修改前的值
    const { data: before } = await supabase
      .from('pantry_items')
      .select('*')
      .eq('id', id)
      .single();

    if (!before) {
      return res.status(404).json({ ok: false, message: '库存项不存在' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (qty_est_lower !== undefined) updates.qty_est_lower = qty_est_lower;
    if (qty_est_upper !== undefined) updates.qty_est_upper = qty_est_upper;
    if (unit !== undefined) updates.unit = unit;
    if (expire_on !== undefined) updates.expire_on = expire_on;

    const { data, error } = await supabase
      .from('pantry_items')
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
      entity: 'pantry_items',
      entity_id: id,
      action: 'calibrate',
      before_value: before,
      after_value: data
    });

    // 如果有备注，添加到 admin_notes
    if (note) {
      await supabase.from('admin_notes').insert({
        target_type: 'pantry_items',
        target_id: id,
        content: note,
        actor_user_id: req.adminUser.id
      });
    }

    res.json({ ok: true, data, trace_id: req.traceId });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// DELETE /admin/pantry/expired - 批量清理过期库存
// =============================================================================

router.delete('/expired', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { household_id } = req.query;
    const supabase = req.supabase;

    let query = supabase
      .from('pantry_items')
      .select('*')
      .lte('expire_on', new Date().toISOString().split('T')[0]);

    if (household_id) {
      query = query.eq('household_id', household_id);
    }

    // 获取将被删除的项
    const { data: toDelete } = await query;

    if (!toDelete || toDelete.length === 0) {
      return res.json({ ok: true, message: '没有过期库存', deleted_count: 0, trace_id: req.traceId });
    }

    // 删除
    let deleteQuery = supabase
      .from('pantry_items')
      .delete()
      .lte('expire_on', new Date().toISOString().split('T')[0]);

    if (household_id) {
      deleteQuery = deleteQuery.eq('household_id', household_id);
    }

    const { error } = await deleteQuery;

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 写入审计日志
    await supabase.from('audit_logs').insert({
      actor_user_id: req.adminUser.id,
      entity: 'pantry_items',
      entity_id: null,
      action: 'batch_delete_expired',
      before_value: { count: toDelete.length, items: toDelete.map(i => i.id) },
      after_value: null
    });

    res.json({
      ok: true,
      message: `已清理 ${toDelete.length} 项过期库存`,
      deleted_count: toDelete.length,
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

