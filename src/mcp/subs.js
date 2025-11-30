/**
 * MCP 工具：subs
 *
 * 替代建议：针对缺料列表给出替代方案，附 delta_timeline / delta_nutrition。
 */

// =============================================================================
// subs.suggest
// =============================================================================

/**
 * 获取替代建议
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {import('../types/api.js').SubsSuggestInput} input
 * @returns {Promise<import('../types/api.js').SubstitutionSuggestion[]>}
 */
export async function subsSuggest(supabase, input) {
  const { missing, context = {} } = input;
  const { diet = [], risk = 'low' } = context;

  if (!missing || missing.length === 0) {
    return [];
  }

  // 查询替代库
  const { data: subs, error } = await supabase
    .from('substitutions')
    .select('*')
    .in('original_ingredient', missing);

  if (error) {
    console.error('[subs.suggest] Error:', error);
    throw error;
  }

  const suggestions = [];

  for (const ingredient of missing) {
    // 查找该食材的替代选项
    const options = (subs || []).filter(s =>
      s.original_ingredient.toLowerCase() === ingredient.toLowerCase()
    );

    if (options.length === 0) {
      // 没有找到替代，建议省略（如果是可选的）
      suggestions.push({
        original_ingredient: ingredient,
        substitute_ingredient: 'omit',
        level: 'allowable',
        ratio: 0,
        delta_timeline_sec: 0,
        delta_nutrition: {},
        notes: 'No substitute found, consider omitting if optional'
      });
      continue;
    }

    // 根据风险偏好过滤
    let filteredOptions = options;
    if (risk === 'low') {
      filteredOptions = options.filter(o => o.level === 'allowable');
    } else if (risk === 'medium') {
      filteredOptions = options.filter(o => o.level !== 'baking_sensitive');
    }

    // 如果过滤后没有选项，使用原始选项中风险最低的
    if (filteredOptions.length === 0) {
      filteredOptions = options.sort((a, b) => {
        const levelOrder = { allowable: 0, risky: 1, baking_sensitive: 2 };
        return levelOrder[a.level] - levelOrder[b.level];
      });
    }

    // 返回最佳选项
    const best = filteredOptions[0];
    suggestions.push({
      original_ingredient: best.original_ingredient,
      substitute_ingredient: best.substitute_ingredient,
      level: best.level,
      ratio: best.ratio || 1,
      delta_timeline_sec: best.delta_timeline_sec || 0,
      delta_nutrition: best.delta_nutrition || {},
      notes: best.notes
    });
  }

  return suggestions;
}

// =============================================================================
// 应用替代到菜谱
// =============================================================================

/**
 * 应用替代到菜谱配料表
 *
 * @param {Object[]} ingredients - 原配料列表
 * @param {import('../types/api.js').SubstitutionSuggestion[]} substitutions - 替代建议
 * @returns {{ ingredients: Object[], applied: import('../types/api.js').SubstitutionApplied[] }}
 */
export function applySubstitutions(ingredients, substitutions) {
  const applied = [];
  const newIngredients = ingredients.map(ing => {
    const sub = substitutions.find(s =>
      s.original_ingredient.toLowerCase() === ing.name.toLowerCase()
    );

    if (!sub || sub.substitute_ingredient === 'omit') {
      return ing;
    }

    applied.push({
      original: ing.name,
      substitute: sub.substitute_ingredient,
      level: sub.level
    });

    return {
      ...ing,
      name: sub.substitute_ingredient,
      qty: ing.qty * sub.ratio,
      is_substituted: true,
      original_name: ing.name
    };
  });

  // 过滤掉被省略的配料
  const filteredIngredients = newIngredients.filter(ing => {
    const sub = substitutions.find(s =>
      s.original_ingredient.toLowerCase() === ing.name?.toLowerCase()
    );
    return !sub || sub.substitute_ingredient !== 'omit';
  });

  return {
    ingredients: filteredIngredients,
    applied
  };
}

export default {
  suggest: subsSuggest,
  apply: applySubstitutions
};

