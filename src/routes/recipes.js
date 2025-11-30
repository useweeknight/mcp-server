/**
 * Recipes REST API 路由
 *
 * GET /recipes/search - 分页搜索菜谱
 * GET /recipes/:id - 获取菜谱详情
 * GET /recipes/:id/timeline - 获取菜谱时间线
 * GET /recipes/:id/cards - 获取步骤图标卡
 */

import { Router } from 'express';
import recipes from '../mcp/recipes.js';

const router = Router();

// =============================================================================
// GET /recipes/search
// =============================================================================

/**
 * 搜索菜谱
 *
 * @route GET /recipes/search
 * @query {string} [q] - 搜索关键词
 * @query {string} [cook_type] - 烹饪方式（逗号分隔）
 * @query {string} [equipment] - 器具（逗号分隔）
 * @query {string} [cuisine] - 菜系
 * @query {string} [tags] - 标签（逗号分隔）
 * @query {number} [time_max] - 最大时间（分钟）
 * @query {number} [cookware_max] - 最大锅具数
 * @query {boolean} [kid_friendly] - 儿童友好
 * @query {number} [page] - 页码（从 1 开始）
 * @query {number} [limit] - 每页数量（默认 20）
 */
router.get('/search', async (req, res) => {
  try {
    const supabase = req.supabase;
    const {
      q,
      cook_type,
      equipment,
      cuisine,
      tags,
      time_max,
      cookware_max,
      kid_friendly,
      page = 1,
      limit = 20
    } = req.query;

    // 构建查询
    let query = supabase
      .from('recipe')
      .select('id, slug, title, title_zh, description, cook_type, equipment, cookware_count, time_total_min, servings, difficulty, kid_friendly, tags, cuisine, hero_image_url, status', { count: 'exact' })
      .eq('status', 'published');

    // 关键词搜索
    if (q) {
      query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,title_zh.ilike.%${q}%`);
    }

    // 烹饪方式
    if (cook_type) {
      const types = cook_type.split(',').map(t => t.trim());
      query = query.overlaps('cook_type', types);
    }

    // 器具
    if (equipment) {
      const equips = equipment.split(',').map(e => e.trim());
      query = query.overlaps('equipment', equips);
    }

    // 菜系
    if (cuisine) {
      query = query.eq('cuisine', cuisine);
    }

    // 标签
    if (tags) {
      const tagList = tags.split(',').map(t => t.trim());
      query = query.overlaps('tags', tagList);
    }

    // 时间
    if (time_max) {
      query = query.lte('time_total_min', parseInt(time_max));
    }

    // 锅具数
    if (cookware_max) {
      query = query.lte('cookware_count', parseInt(cookware_max));
    }

    // 儿童友好
    if (kid_friendly === 'true') {
      query = query.eq('kid_friendly', true);
    }

    // 分页
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    query = query
      .order('time_total_min', { ascending: true })
      .range(offset, offset + limitNum - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[recipes/search] Error:', error);
      return res.status(500).json({
        ok: false,
        message: error.message,
        trace_id: req.traceId
      });
    }

    // 转换为轻量卡片格式
    const cards = (data || []).map(r => ({
      recipe_id: r.id,
      slug: r.slug,
      title: r.title,
      title_zh: r.title_zh,
      hero_image_url: r.hero_image_url,
      time_total_min: r.time_total_min,
      cookware_count: r.cookware_count,
      servings: r.servings,
      difficulty: r.difficulty,
      kid_friendly: r.kid_friendly,
      tags: r.tags,
      cook_type: r.cook_type,
      equipment: r.equipment,
      cuisine: r.cuisine
    }));

    return res.json({
      ok: true,
      data: cards,
      total: count || 0,
      page: pageNum,
      limit: limitNum,
      has_more: offset + cards.length < (count || 0),
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[recipes/search] Error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message,
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// GET /recipes/:id
// =============================================================================

/**
 * 获取菜谱详情
 *
 * @route GET /recipes/:id
 * @param {string} id - 菜谱 ID 或 slug
 */
router.get('/:id', async (req, res) => {
  try {
    const supabase = req.supabase;
    const { id } = req.params;

    // 支持 UUID 或 slug 查询
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    let query = supabase
      .from('recipe')
      .select(`
        *,
        recipe_ingredient (
          id, name, name_zh, qty, unit, is_optional, substitutes, category, sort_order
        ),
        recipe_step (
          id, step_order, instruction, instruction_zh, duration_sec, timer_sec, method, equipment, concurrent_group, cleanup_hint, temperature_f, doneness_cue, icon_keys
        ),
        recipe_media (
          id, step_id, media_type, url, alt_text, sort_order
        ),
        nutrition_snapshot (
          calories_kcal, protein_g, fat_g, carbs_g, fiber_g, sodium_mg, retention_applied, confidence_pct, source
        ),
        recipe_source (
          source_type, source_url, source_name, author, license
        )
      `);

    if (isUUID) {
      query = query.eq('id', id);
    } else {
      query = query.eq('slug', id);
    }

    const { data, error } = await query.single();

    if (error || !data) {
      return res.status(404).json({
        ok: false,
        message: 'Recipe not found',
        trace_id: req.traceId
      });
    }

    // 检查权限（非发布状态需要管理员权限）
    if (data.status !== 'published') {
      // TODO: 检查用户是否为管理员
      // 暂时允许访问
    }

    // 排序配料和步骤
    if (data.recipe_ingredient) {
      data.recipe_ingredient.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
    if (data.recipe_step) {
      data.recipe_step.sort((a, b) => a.step_order - b.step_order);
    }
    if (data.recipe_media) {
      data.recipe_media.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }

    return res.json({
      ok: true,
      data,
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[recipes/:id] Error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message,
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// GET /recipes/:id/timeline
// =============================================================================

/**
 * 获取菜谱时间线
 *
 * @route GET /recipes/:id/timeline
 * @param {string} id - 菜谱 ID
 */
router.get('/:id/timeline', async (req, res) => {
  try {
    const supabase = req.supabase;
    const { id } = req.params;

    const timeline = await recipes.getTimeline(supabase, id);

    return res.json({
      ok: true,
      data: timeline,
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[recipes/:id/timeline] Error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message,
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// GET /recipes/:id/cards
// =============================================================================

/**
 * 获取步骤图标卡
 *
 * @route GET /recipes/:id/cards
 * @param {string} id - 菜谱 ID
 */
router.get('/:id/cards', async (req, res) => {
  try {
    const supabase = req.supabase;
    const { id } = req.params;

    const cards = await recipes.getCards(supabase, id);

    return res.json({
      ok: true,
      data: cards,
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[recipes/:id/cards] Error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message,
      trace_id: req.traceId
    });
  }
});

export default router;

