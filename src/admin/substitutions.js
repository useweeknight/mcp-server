/**
 * Admin Substitutions API
 *
 * 替代库管理：列表、添加、编辑、删除
 */

import { Router } from 'express';
import { requireRole } from '../middleware/adminAuth.js';

const router = Router();

// =============================================================================
// GET /admin/substitutions - 替代列表
// =============================================================================

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, risk_level } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const supabase = req.supabase;

    let query = supabase
      .from('substitutions')
      .select('*', { count: 'exact' });

    if (search) {
      query = query.or(`original.ilike.%${search}%,substitute.ilike.%${search}%`);
    }

    if (risk_level) {
      query = query.eq('risk_level', risk_level);
    }

    const { data, count, error } = await query
      .order('original', { ascending: true })
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
// POST /admin/substitutions - 添加替代
// =============================================================================

router.post('/', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { original, substitute, risk_level, ratio, notes, delta_timeline, delta_nutrition } = req.body;
    const supabase = req.supabase;

    if (!original || !substitute) {
      return res.status(400).json({ ok: false, message: '缺少必填字段' });
    }

    const newSub = {
      original,
      substitute,
      risk_level: risk_level || 'low',
      ratio: ratio || 1.0,
      notes,
      delta_timeline,
      delta_nutrition,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('substitutions')
      .insert(newSub)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 写入审计日志
    await supabase.from('audit_logs').insert({
      actor_user_id: req.adminUser.id,
      entity: 'substitutions',
      entity_id: data.id,
      action: 'create',
      before_value: null,
      after_value: data
    });

    res.status(201).json({ ok: true, data, trace_id: req.traceId });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// PUT /admin/substitutions/:id - 更新替代
// =============================================================================

router.put('/:id', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const supabase = req.supabase;

    // 获取修改前的值
    const { data: before } = await supabase
      .from('substitutions')
      .select('*')
      .eq('id', id)
      .single();

    if (!before) {
      return res.status(404).json({ ok: false, message: '替代记录不存在' });
    }

    const { data, error } = await supabase
      .from('substitutions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 写入审计日志
    await supabase.from('audit_logs').insert({
      actor_user_id: req.adminUser.id,
      entity: 'substitutions',
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
// DELETE /admin/substitutions/:id - 删除替代
// =============================================================================

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.supabase;

    // 获取删除前的值
    const { data: before } = await supabase
      .from('substitutions')
      .select('*')
      .eq('id', id)
      .single();

    if (!before) {
      return res.status(404).json({ ok: false, message: '替代记录不存在' });
    }

    const { error } = await supabase
      .from('substitutions')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 写入审计日志
    await supabase.from('audit_logs').insert({
      actor_user_id: req.adminUser.id,
      entity: 'substitutions',
      entity_id: id,
      action: 'delete',
      before_value: before,
      after_value: null
    });

    res.json({ ok: true, message: '删除成功', trace_id: req.traceId });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

