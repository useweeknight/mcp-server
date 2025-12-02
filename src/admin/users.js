/**
 * Admin Users API
 *
 * 用户管理：列表、详情、角色修改
 */

import { Router } from 'express';
import { requireRole } from '../middleware/adminAuth.js';

const router = Router();

// =============================================================================
// GET /admin/users - 用户列表
// =============================================================================

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const supabase = req.supabase;
    if (!supabase) {
      return res.status(500).json({ ok: false, message: 'Supabase not available' });
    }

    let query = supabase
      .from('users')
      .select('id, email, display_name, avatar_url, role, locale, created_at, updated_at', { count: 'exact' });

    if (search) {
      query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);
    }

    if (role) {
      query = query.eq('role', role);
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
// GET /admin/users/:id - 用户详情
// =============================================================================

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.supabase;

    // 获取用户基本信息
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ ok: false, message: '用户不存在' });
    }

    // 获取用户所属家庭
    const { data: memberships } = await supabase
      .from('household_members')
      .select('household_id, role, households(id, name, settings)')
      .eq('user_id', id);

    // 获取用户的晚餐建议统计
    const { count: suggestionsCount } = await supabase
      .from('dinner_suggestions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);

    res.json({
      ok: true,
      data: {
        ...user,
        households: memberships || [],
        stats: {
          suggestions_count: suggestionsCount || 0
        }
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// PUT /admin/users/:id/role - 修改用户角色（仅 admin 可用）
// =============================================================================

router.put('/:id/role', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const supabase = req.supabase;

    const validRoles = ['user', 'admin', 'operator', 'support'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ ok: false, message: '无效的角色' });
    }

    // 获取修改前的值
    const { data: before } = await supabase
      .from('users')
      .select('role')
      .eq('id', id)
      .single();

    // 更新角色
    const { data, error } = await supabase
      .from('users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 写入审计日志
    await supabase.from('audit_logs').insert({
      actor_user_id: req.adminUser.id,
      entity: 'users',
      entity_id: id,
      action: 'update_role',
      before_value: before,
      after_value: { role }
    });

    res.json({ ok: true, data, trace_id: req.traceId });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

