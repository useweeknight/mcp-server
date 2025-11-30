/**
 * MCP 工具：recipes
 *
 * 菜谱搜索，支持 preferred_appliance 参数，按产品书规则排序。
 * 排序规则：锅少 > 使用库存/剩菜 > 时间≤30min > 家庭适配 > 剩菜潜力 > 器具匹配
 */

// =============================================================================
// 排序权重配置
// =============================================================================

const SORT_WEIGHTS = {
  // 锅具数量（越少越好）
  cookware: 30,
  // 库存利用（使用越多越好）
  pantry_usage: 25,
  // 时间（≤30min 加分）
  time_fit: 15,
  // 家庭适配（kid_friendly 等）
  family_fit: 12,
  // 剩菜潜力
  leftover_potential: 10,
  // 器具匹配
  equipment_match: 8
};

// =============================================================================
// recipes.search
// =============================================================================

/**
 * 搜索菜谱
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {import('../types/api.js').DinnerDSL} dsl - 意图 DSL
 * @param {Object} [context]
 * @param {import('../types/api.js').PantrySnapshot[]} [context.pantry_snapshot] - 库存快照
 * @param {import('../types/api.js').LeftoverItem[]} [context.leftovers] - 剩菜
 * @param {string} [context.preferred_appliance] - 偏好器具
 * @param {number} [context.limit] - 返回数量限制
 * @returns {Promise<{ candidates: import('../types/api.js').SuggestionCard[], decision_time_ms: number }>}
 */
export async function recipesSearch(supabase, dsl, context = {}) {
  const startTime = Date.now();
  const { pantry_snapshot = [], leftovers = [], preferred_appliance, limit = 10 } = context;

  // 构建查询
  let query = supabase
    .from('recipe')
    .select(`
      *,
      recipe_ingredient(*),
      nutrition_snapshot(*)
    `)
    .eq('status', 'published');

  // 时间过滤
  if (dsl.time_max) {
    query = query.lte('time_total_min', dsl.time_max);
  }

  // 锅具数量过滤
  if (dsl.cookware_max) {
    query = query.lte('cookware_count', dsl.cookware_max);
  }

  // 儿童友好过滤
  if (dsl.family?.kid_friendly) {
    query = query.eq('kid_friendly', true);
  }

  // 辣度过滤
  if (dsl.spice_level !== undefined) {
    query = query.lte('spice_level', dsl.spice_level);
  }

  // 油量过滤
  if (dsl.oil_level !== undefined) {
    query = query.lte('oil_level', dsl.oil_level);
  }

  // 烹饪方式过滤
  if (dsl.cook_type && dsl.cook_type.length > 0) {
    query = query.overlaps('cook_type', dsl.cook_type);
  }

  // 器具过滤
  if (preferred_appliance) {
    query = query.contains('equipment', [preferred_appliance]);
  } else if (dsl.equipment && dsl.equipment.length > 0) {
    query = query.overlaps('equipment', dsl.equipment);
  }

  // 菜系过滤
  if (dsl.cuisine && dsl.cuisine.length > 0) {
    query = query.in('cuisine', dsl.cuisine);
  }

  // 执行查询
  const { data: recipes, error } = await query.limit(50);

  if (error) {
    console.error('[recipes.search] Error:', error);
    throw error;
  }

  if (!recipes || recipes.length === 0) {
    return { candidates: [], decision_time_ms: Date.now() - startTime };
  }

  // 计算每个菜谱的分数
  const pantryNames = new Set(pantry_snapshot.map(p => p.name.toLowerCase()));
  const leftoverNames = new Set(leftovers.map(l => l.name.toLowerCase()));
  const mustUseSet = new Set((dsl.must_use || []).map(m => m.toLowerCase()));
  const avoidSet = new Set((dsl.avoid || []).map(a => a.toLowerCase()));

  const scoredRecipes = recipes
    .filter(recipe => {
      // 排除包含避免食材的菜谱
      const ingredients = (recipe.recipe_ingredient || []).map(i => i.name.toLowerCase());
      return !ingredients.some(ing => avoidSet.has(ing));
    })
    .map(recipe => {
      const ingredients = (recipe.recipe_ingredient || []).map(i => i.name.toLowerCase());
      let score = 0;
      const rankReasons = [];

      // 1. 锅具分数（越少越好）
      const cookwareScore = (4 - (recipe.cookware_count || 1)) * SORT_WEIGHTS.cookware / 3;
      score += cookwareScore;
      if (recipe.cookware_count <= 1) {
        rankReasons.push('one-pot');
      }

      // 2. 库存利用分数
      const pantryHits = ingredients.filter(ing =>
        [...pantryNames].some(p => p.includes(ing) || ing.includes(p))
      ).length;
      const mustUseHits = ingredients.filter(ing => mustUseSet.has(ing)).length;
      const pantryScore = (pantryHits + mustUseHits * 2) * SORT_WEIGHTS.pantry_usage / Math.max(ingredients.length, 1);
      score += pantryScore;
      if (mustUseHits > 0) {
        rankReasons.push('uses-your-ingredients');
      }

      // 3. 时间适配分数
      const timeScore = recipe.time_total_min <= 30
        ? SORT_WEIGHTS.time_fit
        : SORT_WEIGHTS.time_fit * (30 / (recipe.time_total_min || 30));
      score += timeScore;
      if (recipe.time_total_min <= 20) {
        rankReasons.push('quick');
      }

      // 4. 家庭适配分数
      let familyScore = 0;
      if (dsl.family?.kid_friendly && recipe.kid_friendly) {
        familyScore += SORT_WEIGHTS.family_fit;
        rankReasons.push('kid-friendly');
      }
      score += familyScore;

      // 5. 剩菜潜力分数
      const leftoverScore = recipe.tags?.includes('meal-prep') ? SORT_WEIGHTS.leftover_potential : 0;
      score += leftoverScore;

      // 6. 器具匹配分数
      let equipmentScore = 0;
      const recipeEquipment = recipe.equipment || [];
      if (preferred_appliance && recipeEquipment.includes(preferred_appliance)) {
        equipmentScore = SORT_WEIGHTS.equipment_match;
        rankReasons.push(`uses-${preferred_appliance}`);
      } else if (recipeEquipment.some(e => ['air-fryer', 'sheet-pan', 'one-pot'].includes(e))) {
        equipmentScore = SORT_WEIGHTS.equipment_match * 0.5;
      }
      score += equipmentScore;

      // 7. 剩菜复用加分
      const leftoverHits = ingredients.filter(ing =>
        [...leftoverNames].some(l => l.includes(ing) || ing.includes(l))
      ).length;
      if (leftoverHits > 0) {
        score += 15;
        rankReasons.push('uses-leftovers');
      }

      // 构建 SuggestionCard
      const nutrition = recipe.nutrition_snapshot?.[0] || recipe.nutrition_snapshot;

      /** @type {import('../types/api.js').SuggestionCard} */
      const card = {
        recipe_id: recipe.id,
        title: recipe.title,
        hero_image_url: recipe.hero_image_url,
        time_total_min: recipe.time_total_min || 30,
        cookware_count: recipe.cookware_count || 1,
        servings: recipe.servings || 2,
        tags: recipe.tags || [],
        kid_friendly: recipe.kid_friendly || false,
        equipment: recipe.equipment || [],
        substitutions_applied: [],
        leftover_potential: {
          suitable: recipe.tags?.includes('meal-prep') || false,
          transformation: null,
          safe_hours: 72
        },
        nutrition: nutrition ? {
          calories_kcal: nutrition.calories_kcal,
          protein_g: nutrition.protein_g,
          fat_g: nutrition.fat_g,
          carbs_g: nutrition.carbs_g,
          fiber_g: nutrition.fiber_g,
          sodium_mg: nutrition.sodium_mg,
          retention_applied: nutrition.retention_applied,
          confidence_pct: nutrition.confidence_pct,
          source: nutrition.source
        } : null,
        score: Math.round(score * 100) / 100,
        rank_reasons: rankReasons
      };

      return card;
    });

  // 按分数排序
  scoredRecipes.sort((a, b) => b.score - a.score);

  // 返回前 N 个
  const candidates = scoredRecipes.slice(0, limit);

  return {
    candidates,
    decision_time_ms: Date.now() - startTime
  };
}

// =============================================================================
// 获取单个菜谱详情
// =============================================================================

/**
 * 获取菜谱详情
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} recipeId - 菜谱 ID
 * @returns {Promise<Object|null>}
 */
export async function getRecipeById(supabase, recipeId) {
  const { data, error } = await supabase
    .from('recipe')
    .select(`
      *,
      recipe_ingredient(*),
      recipe_step(*),
      recipe_media(*),
      nutrition_snapshot(*),
      recipe_source(*)
    `)
    .eq('id', recipeId)
    .single();

  if (error) {
    console.error('[recipes.getById] Error:', error);
    return null;
  }

  return data;
}

// =============================================================================
// 获取菜谱时间线
// =============================================================================

/**
 * 获取菜谱时间线
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} recipeId - 菜谱 ID
 * @returns {Promise<import('../types/api.js').TimelineStep[]>}
 */
export async function getRecipeTimeline(supabase, recipeId) {
  const { data, error } = await supabase
    .from('recipe_step')
    .select('*')
    .eq('recipe_id', recipeId)
    .order('step_order', { ascending: true });

  if (error) {
    console.error('[recipes.getTimeline] Error:', error);
    throw error;
  }

  // 转换为 TimelineStep 格式
  return (data || []).map(step => ({
    id: step.id,
    step_order: step.step_order,
    instruction: step.instruction,
    instruction_zh: step.instruction_zh,
    duration_sec: step.duration_sec,
    timer_sec: step.timer_sec,
    method: step.method,
    equipment: step.equipment,
    concurrent_group: step.concurrent_group,
    cleanup_hint: step.cleanup_hint,
    temperature_f: step.temperature_f,
    doneness_cue: step.doneness_cue,
    icon_keys: step.icon_keys,
    panic_fix: null // 后续可扩展
  }));
}

// =============================================================================
// 获取步骤图标卡
// =============================================================================

/**
 * 获取步骤图标卡
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} recipeId - 菜谱 ID
 * @returns {Promise<import('../types/api.js').StepIconCard[]>}
 */
export async function getRecipeCards(supabase, recipeId) {
  const { data: steps, error } = await supabase
    .from('recipe_step')
    .select('*')
    .eq('recipe_id', recipeId)
    .order('step_order', { ascending: true });

  if (error) {
    console.error('[recipes.getCards] Error:', error);
    throw error;
  }

  // 转换为 StepIconCard 格式
  return (steps || []).map(step => {
    const badges = [];
    const cues = [];

    // 并行标识
    if (step.concurrent_group) {
      badges.push('parallel');
    }

    // 温度提示
    if (step.temperature_f) {
      cues.push(`${step.temperature_f}°F`);
    }

    // 完成指标
    if (step.doneness_cue) {
      cues.push(step.doneness_cue);
    }

    // 时间
    const timeMin = step.duration_sec ? Math.ceil(step.duration_sec / 60) : null;
    const subtitle = timeMin ? `${timeMin} min` : '';

    return {
      step_id: step.id,
      icon_keys: step.icon_keys || [step.method || 'cook'],
      title: step.instruction?.substring(0, 50) || '',
      subtitle,
      badges,
      cues
    };
  });
}

export default {
  search: recipesSearch,
  getById: getRecipeById,
  getTimeline: getRecipeTimeline,
  getCards: getRecipeCards
};

