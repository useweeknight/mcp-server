/**
 * MCP 工具：nutrition
 *
 * 营养信息查询。
 * 当前使用 mock 数据实现，后续可替换为 USDA/Edamam/Spoonacular API。
 *
 * 标准输入：
 *   { ingredient: string, qty?: number, unit?: string }
 *
 * 标准输出：
 *   { ingredient: string, nutrition: NutritionInfo, cached: boolean }
 */

// =============================================================================
// Mock 营养数据库（每 100g）
// =============================================================================

const MOCK_NUTRITION_DB = {
  // 蛋白质类
  'chicken breast': { calories_kcal: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0, fiber_g: 0, sodium_mg: 74 },
  'chicken thigh': { calories_kcal: 209, protein_g: 26, fat_g: 10.9, carbs_g: 0, fiber_g: 0, sodium_mg: 84 },
  'beef': { calories_kcal: 250, protein_g: 26, fat_g: 15, carbs_g: 0, fiber_g: 0, sodium_mg: 72 },
  'ground beef': { calories_kcal: 254, protein_g: 17, fat_g: 20, carbs_g: 0, fiber_g: 0, sodium_mg: 75 },
  'pork': { calories_kcal: 242, protein_g: 27, fat_g: 14, carbs_g: 0, fiber_g: 0, sodium_mg: 62 },
  'salmon': { calories_kcal: 208, protein_g: 20, fat_g: 13, carbs_g: 0, fiber_g: 0, sodium_mg: 59 },
  'shrimp': { calories_kcal: 99, protein_g: 24, fat_g: 0.3, carbs_g: 0.2, fiber_g: 0, sodium_mg: 111 },
  'egg': { calories_kcal: 155, protein_g: 13, fat_g: 11, carbs_g: 1.1, fiber_g: 0, sodium_mg: 124 },
  'tofu': { calories_kcal: 76, protein_g: 8, fat_g: 4.8, carbs_g: 1.9, fiber_g: 0.3, sodium_mg: 7 },

  // 蔬菜类
  'spinach': { calories_kcal: 23, protein_g: 2.9, fat_g: 0.4, carbs_g: 3.6, fiber_g: 2.2, sodium_mg: 79 },
  'broccoli': { calories_kcal: 34, protein_g: 2.8, fat_g: 0.4, carbs_g: 7, fiber_g: 2.6, sodium_mg: 33 },
  'carrot': { calories_kcal: 41, protein_g: 0.9, fat_g: 0.2, carbs_g: 10, fiber_g: 2.8, sodium_mg: 69 },
  'tomato': { calories_kcal: 18, protein_g: 0.9, fat_g: 0.2, carbs_g: 3.9, fiber_g: 1.2, sodium_mg: 5 },
  'onion': { calories_kcal: 40, protein_g: 1.1, fat_g: 0.1, carbs_g: 9.3, fiber_g: 1.7, sodium_mg: 4 },
  'garlic': { calories_kcal: 149, protein_g: 6.4, fat_g: 0.5, carbs_g: 33, fiber_g: 2.1, sodium_mg: 17 },
  'potato': { calories_kcal: 77, protein_g: 2, fat_g: 0.1, carbs_g: 17, fiber_g: 2.2, sodium_mg: 6 },
  'bell pepper': { calories_kcal: 31, protein_g: 1, fat_g: 0.3, carbs_g: 6, fiber_g: 2.1, sodium_mg: 4 },
  'mushroom': { calories_kcal: 22, protein_g: 3.1, fat_g: 0.3, carbs_g: 3.3, fiber_g: 1, sodium_mg: 5 },
  'zucchini': { calories_kcal: 17, protein_g: 1.2, fat_g: 0.3, carbs_g: 3.1, fiber_g: 1, sodium_mg: 8 },
  'cabbage': { calories_kcal: 25, protein_g: 1.3, fat_g: 0.1, carbs_g: 5.8, fiber_g: 2.5, sodium_mg: 18 },

  // 谷物类
  'rice': { calories_kcal: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28, fiber_g: 0.4, sodium_mg: 1 },
  'pasta': { calories_kcal: 131, protein_g: 5, fat_g: 1.1, carbs_g: 25, fiber_g: 1.8, sodium_mg: 1 },
  'bread': { calories_kcal: 265, protein_g: 9, fat_g: 3.2, carbs_g: 49, fiber_g: 2.7, sodium_mg: 491 },
  'noodle': { calories_kcal: 138, protein_g: 4.5, fat_g: 2, carbs_g: 25, fiber_g: 1.2, sodium_mg: 5 },

  // 乳制品
  'milk': { calories_kcal: 42, protein_g: 3.4, fat_g: 1, carbs_g: 5, fiber_g: 0, sodium_mg: 44 },
  'cheese': { calories_kcal: 402, protein_g: 25, fat_g: 33, carbs_g: 1.3, fiber_g: 0, sodium_mg: 621 },
  'butter': { calories_kcal: 717, protein_g: 0.9, fat_g: 81, carbs_g: 0.1, fiber_g: 0, sodium_mg: 11 },
  'yogurt': { calories_kcal: 59, protein_g: 10, fat_g: 0.7, carbs_g: 3.6, fiber_g: 0, sodium_mg: 36 },

  // 油脂
  'olive oil': { calories_kcal: 884, protein_g: 0, fat_g: 100, carbs_g: 0, fiber_g: 0, sodium_mg: 2 },
  'vegetable oil': { calories_kcal: 884, protein_g: 0, fat_g: 100, carbs_g: 0, fiber_g: 0, sodium_mg: 0 },

  // 调料（每 tbsp 约 15g）
  'soy sauce': { calories_kcal: 53, protein_g: 8.1, fat_g: 0.1, carbs_g: 4.9, fiber_g: 0.8, sodium_mg: 5493 },
  'salt': { calories_kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sodium_mg: 38758 },
  'sugar': { calories_kcal: 387, protein_g: 0, fat_g: 0, carbs_g: 100, fiber_g: 0, sodium_mg: 1 },
  'honey': { calories_kcal: 304, protein_g: 0.3, fat_g: 0, carbs_g: 82, fiber_g: 0.2, sodium_mg: 4 }
};

// 简单内存缓存
const cache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// =============================================================================
// nutrition.lookup
// =============================================================================

/**
 * 查询食材营养信息
 *
 * @param {import('../types/api.js').NutritionLookupInput} input
 * @returns {Promise<import('../types/api.js').NutritionLookupResult>}
 */
export async function nutritionLookup(input) {
  const { ingredient, qty = 100, unit = 'g' } = input;
  const cacheKey = ingredient.toLowerCase();

  // 检查缓存
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      ingredient,
      nutrition: scaleNutrition(cached.data, qty, unit),
      cached: true
    };
  }

  // 查找 mock 数据
  const mockData = findMockNutrition(ingredient);

  if (mockData) {
    // 存入缓存
    cache.set(cacheKey, {
      data: mockData,
      timestamp: Date.now()
    });

    return {
      ingredient,
      nutrition: {
        ...scaleNutrition(mockData, qty, unit),
        retention_applied: false,
        confidence_pct: 85,
        source: 'mock'
      },
      cached: false
    };
  }

  // 未找到，返回 null 营养信息（negative caching）
  cache.set(cacheKey, {
    data: null,
    timestamp: Date.now()
  });

  return {
    ingredient,
    nutrition: null,
    cached: false
  };
}

/**
 * 在 mock 数据库中查找营养信息
 * @param {string} ingredient
 * @returns {Object|null}
 */
function findMockNutrition(ingredient) {
  const normalized = ingredient.toLowerCase().trim();

  // 精确匹配
  if (MOCK_NUTRITION_DB[normalized]) {
    return MOCK_NUTRITION_DB[normalized];
  }

  // 部分匹配
  for (const [key, data] of Object.entries(MOCK_NUTRITION_DB)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return data;
    }
  }

  return null;
}

/**
 * 按数量缩放营养信息
 * @param {Object} nutrition - 每 100g 营养信息
 * @param {number} qty - 目标数量
 * @param {string} unit - 单位
 * @returns {import('../types/api.js').NutritionInfo}
 */
function scaleNutrition(nutrition, qty, unit) {
  if (!nutrition) return null;

  // 将单位转换为克
  let grams = qty;
  switch (unit?.toLowerCase()) {
    case 'kg':
      grams = qty * 1000;
      break;
    case 'oz':
      grams = qty * 28.35;
      break;
    case 'lb':
      grams = qty * 453.6;
      break;
    case 'cup':
      grams = qty * 240; // 近似
      break;
    case 'tbsp':
      grams = qty * 15;
      break;
    case 'tsp':
      grams = qty * 5;
      break;
    case 'piece':
    case 'pieces':
    case '个':
      grams = qty * 50; // 近似每个 50g
      break;
    case 'g':
    default:
      grams = qty;
  }

  const scale = grams / 100;

  return {
    calories_kcal: Math.round(nutrition.calories_kcal * scale),
    protein_g: Math.round(nutrition.protein_g * scale * 10) / 10,
    fat_g: Math.round(nutrition.fat_g * scale * 10) / 10,
    carbs_g: Math.round(nutrition.carbs_g * scale * 10) / 10,
    fiber_g: Math.round(nutrition.fiber_g * scale * 10) / 10,
    sodium_mg: Math.round(nutrition.sodium_mg * scale)
  };
}

/**
 * 批量查询营养信息
 *
 * @param {import('../types/api.js').NutritionLookupInput[]} inputs
 * @returns {Promise<import('../types/api.js').NutritionLookupResult[]>}
 */
export async function nutritionLookupBatch(inputs) {
  return Promise.all(inputs.map(input => nutritionLookup(input)));
}

/**
 * 合并多个食材的营养信息
 *
 * @param {import('../types/api.js').NutritionInfo[]} nutritions
 * @returns {import('../types/api.js').NutritionInfo}
 */
export function mergeNutrition(nutritions) {
  const result = {
    calories_kcal: 0,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
    fiber_g: 0,
    sodium_mg: 0,
    retention_applied: false,
    confidence_pct: 0,
    source: 'calculated'
  };

  let count = 0;
  for (const n of nutritions) {
    if (!n) continue;
    result.calories_kcal += n.calories_kcal || 0;
    result.protein_g += n.protein_g || 0;
    result.fat_g += n.fat_g || 0;
    result.carbs_g += n.carbs_g || 0;
    result.fiber_g += n.fiber_g || 0;
    result.sodium_mg += n.sodium_mg || 0;
    result.confidence_pct += n.confidence_pct || 0;
    count++;
  }

  if (count > 0) {
    result.confidence_pct = Math.round(result.confidence_pct / count);
  }

  // 四舍五入
  result.protein_g = Math.round(result.protein_g * 10) / 10;
  result.fat_g = Math.round(result.fat_g * 10) / 10;
  result.carbs_g = Math.round(result.carbs_g * 10) / 10;
  result.fiber_g = Math.round(result.fiber_g * 10) / 10;

  return result;
}

/**
 * 获取缓存统计
 * @returns {{ size: number, hit_rate: number }}
 */
export function getCacheStats() {
  return {
    size: cache.size,
    hit_rate: 0 // TODO: 实现命中率统计
  };
}

export default {
  lookup: nutritionLookup,
  lookupBatch: nutritionLookupBatch,
  merge: mergeNutrition,
  getCacheStats
};

