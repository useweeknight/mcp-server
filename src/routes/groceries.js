/**
 * Groceries API 路由
 *
 * 购物清单生成：从菜谱生成过道分组购物清单
 * 纯计算接口，不写数据库
 */

import { Router } from 'express';
import { mergeByStoreAisle } from '../mcp/groceries.js';

const router = Router();

// =============================================================================
// POST /api/groceries - 生成购物清单
// =============================================================================

/**
 * 从菜谱生成购物清单
 *
 * @route POST /api/groceries
 * @body {Object[]} recipes - 菜谱列表
 * @body {string} recipes[].recipe_id - 菜谱 ID
 * @body {number} [recipes[].servings] - 份数（默认使用菜谱原始份数）
 * @body {Object[]} [pantry_snapshot] - 库存快照（用于排除已有食材）
 * @body {string} [store_preference] - 商店偏好
 * @returns {Object} 过道分组购物清单
 */
router.post('/', async (req, res) => {
  try {
    const {
      recipes = [],
      pantry_snapshot = [],
      store_preference
    } = req.body;

    // 参数校验
    if (!recipes || recipes.length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Missing recipes array',
        trace_id: req.traceId
      });
    }

    const supabase = req.supabase;
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        message: 'Supabase client not available',
        trace_id: req.traceId
      });
    }

    // 获取所有菜谱的配料
    const recipeIds = recipes.map(r => r.recipe_id);
    const servingsMap = {};
    recipes.forEach(r => {
      servingsMap[r.recipe_id] = r.servings || null;
    });

    // 查询菜谱基本信息
    const { data: recipeData, error: recipeError } = await supabase
      .from('recipe')
      .select('id, title, servings')
      .in('id', recipeIds);

    if (recipeError) {
      console.error('[groceries] Recipe query error:', recipeError);
      return res.status(500).json({
        ok: false,
        message: recipeError.message,
        trace_id: req.traceId
      });
    }

    // 查询配料
    const { data: ingredientsData, error: ingredientsError } = await supabase
      .from('recipe_ingredient')
      .select('*')
      .in('recipe_id', recipeIds);

    if (ingredientsError) {
      console.error('[groceries] Ingredients query error:', ingredientsError);
      return res.status(500).json({
        ok: false,
        message: ingredientsError.message,
        trace_id: req.traceId
      });
    }

    // 处理配料：按份数调整用量
    const allIngredients = [];

    for (const ing of (ingredientsData || [])) {
      const recipe = (recipeData || []).find(r => r.id === ing.recipe_id);
      const originalServings = recipe?.servings || 1;
      const targetServings = servingsMap[ing.recipe_id] || originalServings;
      const multiplier = targetServings / originalServings;

      allIngredients.push({
        name: ing.name,
        qty: (ing.qty || 0) * multiplier,
        unit: ing.unit,
        recipe_id: ing.recipe_id,
        recipe_title: recipe?.title,
        is_optional: ing.is_optional || false,
        category: ing.category || guessCategory(ing.name),
        aisle: ing.aisle || guessAisle(ing.name)
      });
    }

    // 排除库存中已有的食材
    const pantryNames = new Set(
      pantry_snapshot.map(p => p.name.toLowerCase())
    );

    const needToBuy = allIngredients.filter(ing => {
      if (ing.is_optional) return false;
      return !pantryNames.has(ing.name.toLowerCase());
    });

    // 调用 MCP 工具合并并分组
    const grouped = mergeByStoreAisle(needToBuy, { store_preference });

    res.json({
      ok: true,
      grocery_list: grouped,
      total_items: needToBuy.length,
      recipes_included: recipeIds.length,
      trace_id: req.traceId
    });

  } catch (error) {
    console.error('[groceries] POST error:', error);
    res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// 辅助函数
// =============================================================================

/**
 * 猜测食材分类
 */
function guessCategory(name) {
  const lowerName = name.toLowerCase();

  if (/chicken|beef|pork|lamb|fish|shrimp|salmon|tuna|meat/.test(lowerName)) {
    return 'protein';
  }
  if (/milk|cheese|yogurt|butter|cream|egg/.test(lowerName)) {
    return 'dairy';
  }
  if (/lettuce|spinach|broccoli|carrot|onion|garlic|tomato|pepper|cucumber|celery|vegetable/.test(lowerName)) {
    return 'produce';
  }
  if (/rice|pasta|noodle|bread|flour|oat|cereal/.test(lowerName)) {
    return 'grains';
  }
  if (/oil|vinegar|soy sauce|salt|pepper|spice|sauce/.test(lowerName)) {
    return 'condiments';
  }
  if (/frozen|ice cream/.test(lowerName)) {
    return 'frozen';
  }

  return 'other';
}

/**
 * 猜测过道
 */
function guessAisle(name) {
  const lowerName = name.toLowerCase();

  if (/chicken|beef|pork|lamb|fish|shrimp|salmon|tuna|meat/.test(lowerName)) {
    return 'Meat & Seafood';
  }
  if (/milk|cheese|yogurt|butter|cream|egg/.test(lowerName)) {
    return 'Dairy';
  }
  if (/lettuce|spinach|broccoli|carrot|onion|garlic|tomato|pepper|cucumber|celery|vegetable|fruit|apple|banana|lemon/.test(lowerName)) {
    return 'Produce';
  }
  if (/rice|pasta|noodle|bread|flour|oat|cereal/.test(lowerName)) {
    return 'Grains & Pasta';
  }
  if (/oil|vinegar|soy sauce|salt|pepper|spice|sauce|ketchup|mustard/.test(lowerName)) {
    return 'Condiments';
  }
  if (/frozen|ice cream/.test(lowerName)) {
    return 'Frozen';
  }
  if (/can|canned|bean|soup/.test(lowerName)) {
    return 'Canned Goods';
  }

  return 'Other';
}

export default router;

