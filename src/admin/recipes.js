/**
 * Admin Recipes API
 *
 * 菜谱管理：列表、详情、编辑、状态管理
 * 严格遵循 ops-config/supabase/schema.sql 的表结构
 */

import { Router } from 'express';
import { requireRole } from '../middleware/adminAuth.js';

const router = Router();

// =============================================================================
// GET /admin/recipes - 菜谱列表
// =============================================================================

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, cook_type, tags } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const supabase = req.supabase;

    let query = supabase
      .from('recipe')
      .select('id, slug, title, title_zh, cook_type, equipment, cookware_count, time_total_min, servings, difficulty, kid_friendly, tags, cuisine, hero_image_url, status, created_at, updated_at', { count: 'exact' });

    if (search) {
      query = query.or(`title.ilike.%${search}%,title_zh.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (cook_type) {
      query = query.contains('cook_type', [cook_type]);
    }

    if (tags) {
      query = query.contains('tags', tags.split(','));
    }

    const { data, count, error } = await query
      .order('updated_at', { ascending: false })
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
// GET /admin/recipes/:id - 菜谱详情（含步骤、配料、营养）
// =============================================================================

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.supabase;

    // 获取菜谱基本信息
    const { data: recipe, error: recipeError } = await supabase
      .from('recipe')
      .select('*')
      .eq('id', id)
      .single();

    if (recipeError || !recipe) {
      return res.status(404).json({ ok: false, message: '菜谱不存在' });
    }

    // 获取步骤
    const { data: steps } = await supabase
      .from('recipe_step')
      .select('*')
      .eq('recipe_id', id)
      .order('step_order', { ascending: true });

    // 获取配料
    const { data: ingredients } = await supabase
      .from('recipe_ingredient')
      .select('*')
      .eq('recipe_id', id)
      .order('sort_order', { ascending: true });

    // 获取营养信息
    const { data: nutrition } = await supabase
      .from('nutrition_snapshot')
      .select('*')
      .eq('recipe_id', id)
      .single();

    // 获取媒体
    const { data: media } = await supabase
      .from('recipe_media')
      .select('*')
      .eq('recipe_id', id)
      .order('sort_order', { ascending: true });

    res.json({
      ok: true,
      data: {
        ...recipe,
        steps: steps || [],
        ingredients: ingredients || [],
        nutrition: nutrition || null,
        media: media || []
      },
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

// =============================================================================
// PUT /admin/recipes/:id - 更新菜谱
// =============================================================================

router.put('/:id', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const supabase = req.supabase;

    // 获取修改前的值
    const { data: before } = await supabase
      .from('recipe')
      .select('*')
      .eq('id', id)
      .single();

    if (!before) {
      return res.status(404).json({ ok: false, message: '菜谱不存在' });
    }

    // 只允许更新特定字段
    const allowedFields = [
      'title', 'title_zh', 'description', 'cook_type', 'equipment',
      'cookware_count', 'time_prep_min', 'time_cook_min', 'time_total_min',
      'servings', 'difficulty', 'oil_level', 'spice_level', 'kid_friendly',
      'tags', 'cuisine', 'hero_image_url', 'status'
    ];

    const filteredUpdates = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }
    filteredUpdates.updated_at = new Date().toISOString();

    // 更新菜谱
    const { data, error } = await supabase
      .from('recipe')
      .update(filteredUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, message: error.message });
    }

    // 写入审计日志
    await supabase.from('audit_logs').insert({
      actor_user_id: req.adminUser.id,
      entity: 'recipe',
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
// PUT /admin/recipes/:id/status - 更新菜谱状态
// =============================================================================

router.put('/:id/status', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const supabase = req.supabase;

    const validStatuses = ['draft', 'published', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, message: '无效的状态' });
    }

    // 获取修改前的值
    const { data: before } = await supabase
      .from('recipe')
      .select('status')
      .eq('id', id)
      .single();

    const updates = { status, updated_at: new Date().toISOString() };
    if (status === 'published') {
      updates.published_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('recipe')
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
      entity: 'recipe',
      entity_id: id,
      action: 'update_status',
      before_value: before,
      after_value: { status }
    });

    res.json({ ok: true, data, trace_id: req.traceId });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

