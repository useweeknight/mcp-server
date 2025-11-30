/**
 * Tonight API 路由
 *
 * POST /api/tonight - Tonight 主链路
 *
 * 流程：
 * 1. 调用 intent_normalizer 解析用户输入
 * 2. 从 Supabase 拉取 pantry_items / leftovers（按 household_id）
 * 3. 调用 recipes.search 获取候选菜谱
 * 4. 调用 subs.suggest 处理缺料
 * 5. 组装 SuggestionCard[] + TimelineStep[]
 */

import { Router } from 'express';
import { intentNormalizer } from '../mcp/intentNormalizer.js';
import { pantrySearch } from '../mcp/pantry.js';
import { recipesSearch, getRecipeTimeline } from '../mcp/recipes.js';
import { subsSuggest, applySubstitutions } from '../mcp/subs.js';
import { recordSchemaViolation } from '../middleware/metrics.js';

const router = Router();

// =============================================================================
// POST /api/tonight
// =============================================================================

/**
 * Tonight 主链路
 *
 * @route POST /api/tonight
 * @body {TonightInput} - 入参
 * @returns {TonightOutput} - 出参
 */
router.post('/', async (req, res) => {
  const startTime = Date.now();
  const traceId = req.traceId;

  try {
    // 1. 验证入参
    const { user_id, text_input, pantry_snapshot } = req.body;

    if (!user_id) {
      recordSchemaViolation('/api/tonight');
      return res.status(400).json({
        ok: false,
        message: 'Missing user_id',
        trace_id: traceId
      });
    }

    if (!text_input) {
      recordSchemaViolation('/api/tonight');
      return res.status(400).json({
        ok: false,
        message: 'Missing text_input',
        trace_id: traceId
      });
    }

    const supabase = req.supabase;
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        message: 'Supabase client not available',
        trace_id: traceId
      });
    }

    // 2. 获取用户的 household_id
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', user_id)
      .limit(1)
      .single();

    const householdId = membership?.household_id;

    // 3. 意图解析
    console.log(`[Tonight] Parsing intent for trace=${traceId}`);
    const intentResult = await intentNormalizer(text_input);
    const { dsl, clarifying_question } = intentResult;

    // 如果需要澄清，返回澄清问题
    if (clarifying_question) {
      return res.json({
        ok: true,
        clarifying_question,
        suggestions: [],
        timeline: [],
        side_dishes: [],
        trace_id: traceId,
        decision_time_ms: Date.now() - startTime
      });
    }

    // 4. 获取库存和剩菜
    let pantryItems = [];
    let leftovers = [];

    if (householdId) {
      // 从数据库获取库存
      pantryItems = await pantrySearch(supabase, householdId);

      // 获取剩菜
      const { data: leftoverData } = await supabase
        .from('leftovers')
        .select('*')
        .eq('household_id', householdId)
        .eq('is_consumed', false)
        .gte('safe_until', new Date().toISOString());

      leftovers = leftoverData || [];
    }

    // 合并用户提供的库存快照
    const combinedPantry = [
      ...pantryItems.map(p => ({
        name: p.name,
        qty_est_range: { lower: p.qty_est_lower || 0, upper: p.qty_est_upper || 0 },
        unit: p.unit
      })),
      ...(pantry_snapshot || [])
    ];

    // 5. 搜索菜谱
    console.log(`[Tonight] Searching recipes for trace=${traceId}`);
    const { candidates, decision_time_ms: searchTime } = await recipesSearch(
      supabase,
      dsl,
      {
        pantry_snapshot: combinedPantry,
        leftovers,
        preferred_appliance: dsl.equipment?.[0],
        limit: 10
      }
    );

    if (candidates.length === 0) {
      // 降级：返回黄金菜
      console.log(`[Tonight] No candidates, falling back to golden recipes`);
      const { data: goldenRecipes } = await supabase
        .from('recipe')
        .select('*')
        .eq('status', 'published')
        .contains('tags', ['golden'])
        .limit(3);

      if (goldenRecipes && goldenRecipes.length > 0) {
        const fallbackCandidates = goldenRecipes.map(r => ({
          recipe_id: r.id,
          title: r.title,
          hero_image_url: r.hero_image_url,
          time_total_min: r.time_total_min || 30,
          cookware_count: r.cookware_count || 1,
          servings: r.servings || 2,
          tags: r.tags || [],
          kid_friendly: r.kid_friendly || false,
          equipment: r.equipment || [],
          substitutions_applied: [],
          leftover_potential: { suitable: false, transformation: null, safe_hours: 72 },
          nutrition: null,
          score: 50,
          rank_reasons: ['fallback-golden']
        }));

        return res.json({
          ok: true,
          suggestions: fallbackCandidates,
          timeline: [],
          side_dishes: [],
          trace_id: traceId,
          decision_time_ms: Date.now() - startTime
        });
      }

      return res.json({
        ok: true,
        suggestions: [],
        timeline: [],
        side_dishes: [],
        trace_id: traceId,
        decision_time_ms: Date.now() - startTime,
        message: 'No matching recipes found'
      });
    }

    // 6. 检查缺料并获取替代建议
    const topCandidates = candidates.slice(0, 3);

    for (const candidate of topCandidates) {
      // 获取菜谱配料
      const { data: ingredients } = await supabase
        .from('recipe_ingredient')
        .select('*')
        .eq('recipe_id', candidate.recipe_id);

      if (!ingredients) continue;

      // 检查缺料
      const missing = [];
      for (const ing of ingredients) {
        if (ing.is_optional) continue;

        const inPantry = combinedPantry.some(p =>
          p.name.toLowerCase().includes(ing.name.toLowerCase()) ||
          ing.name.toLowerCase().includes(p.name.toLowerCase())
        );

        if (!inPantry) {
          missing.push(ing.name);
        }
      }

      // 获取替代建议
      if (missing.length > 0 && missing.length <= 3) {
        const substitutions = await subsSuggest(supabase, {
          recipe_id: candidate.recipe_id,
          missing,
          context: { risk: 'low' }
        });

        candidate.substitutions_applied = substitutions
          .filter(s => s.level === 'allowable')
          .map(s => ({
            original: s.original_ingredient,
            substitute: s.substitute_ingredient,
            level: s.level
          }));
      }
    }

    // 7. 获取第一个候选的时间线
    let timeline = [];
    if (topCandidates.length > 0) {
      timeline = await getRecipeTimeline(supabase, topCandidates[0].recipe_id);
    }

    // 8. 生成可选配菜（简化版）
    const sideDishes = generateSideDishes(dsl, topCandidates[0]);

    // 9. 记录到 dinner_suggestions 表
    if (householdId) {
      await supabase.from('dinner_suggestions').insert({
        user_id,
        household_id: householdId,
        input_text: text_input,
        dsl: intentResult.dsl,
        candidates: topCandidates.map(c => ({
          recipe_id: c.recipe_id,
          score: c.score,
          rank_reasons: c.rank_reasons
        })),
        selected_recipe_id: null,
        leftovers_used: leftovers.length > 0 ? leftovers.map(l => l.id) : null,
        substitutions_applied: topCandidates[0]?.substitutions_applied || null,
        decision_time_ms: Date.now() - startTime
      });
    }

    // 10. 返回结果
    return res.json({
      ok: true,
      suggestions: topCandidates,
      timeline,
      side_dishes: sideDishes,
      trace_id: traceId,
      decision_time_ms: Date.now() - startTime
    });

  } catch (error) {
    console.error('[Tonight] Error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: traceId
    });
  }
});

// =============================================================================
// 辅助函数
// =============================================================================

/**
 * 生成可选配菜
 *
 * @param {import('../types/api.js').DinnerDSL} dsl
 * @param {import('../types/api.js').SuggestionCard} mainDish
 * @returns {import('../types/api.js').SideDish[]}
 */
function generateSideDishes(dsl, mainDish) {
  // 简化版：返回 2 个快速配菜建议
  const sideDishes = [
    {
      name: 'Quick Salad',
      time_min: 5,
      equipment: [],
      steps: [
        'Wash and dry lettuce',
        'Add cherry tomatoes and cucumber',
        'Drizzle with olive oil and lemon'
      ],
      insert_window: 'while-simmering'
    },
    {
      name: 'Steamed Rice',
      time_min: 10,
      equipment: ['rice-cooker'],
      steps: [
        'Rinse rice until water runs clear',
        'Add water (1:1.2 ratio)',
        'Cook until done'
      ],
      insert_window: 'at-start'
    }
  ];

  // 根据主菜类型调整配菜
  if (mainDish?.tags?.includes('asian')) {
    sideDishes[0] = {
      name: 'Cucumber Salad',
      time_min: 5,
      equipment: [],
      steps: [
        'Slice cucumber thinly',
        'Mix with rice vinegar and sesame oil',
        'Sprinkle with sesame seeds'
      ],
      insert_window: 'while-waiting'
    };
  }

  return sideDishes;
}

export default router;

