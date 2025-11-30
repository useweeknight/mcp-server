/**
 * MCP 工具：groceries
 *
 * 购物清单生成与过道分组。
 */

// =============================================================================
// 过道分类映射
// =============================================================================

const AISLE_MAPPING = {
  // 蔬菜
  'vegetable': 'Produce',
  'lettuce': 'Produce',
  'tomato': 'Produce',
  'onion': 'Produce',
  'garlic': 'Produce',
  'potato': 'Produce',
  'carrot': 'Produce',
  'broccoli': 'Produce',
  'spinach': 'Produce',
  'pepper': 'Produce',
  'mushroom': 'Produce',
  'cabbage': 'Produce',
  'celery': 'Produce',
  'cucumber': 'Produce',
  'zucchini': 'Produce',
  'eggplant': 'Produce',

  // 水果
  'fruit': 'Produce',
  'apple': 'Produce',
  'banana': 'Produce',
  'lemon': 'Produce',
  'lime': 'Produce',
  'orange': 'Produce',

  // 肉类
  'protein': 'Meat & Seafood',
  'chicken': 'Meat & Seafood',
  'beef': 'Meat & Seafood',
  'pork': 'Meat & Seafood',
  'fish': 'Meat & Seafood',
  'shrimp': 'Meat & Seafood',
  'salmon': 'Meat & Seafood',
  'ground': 'Meat & Seafood',
  'steak': 'Meat & Seafood',
  'bacon': 'Meat & Seafood',
  'sausage': 'Meat & Seafood',

  // 乳制品
  'dairy': 'Dairy & Eggs',
  'milk': 'Dairy & Eggs',
  'cheese': 'Dairy & Eggs',
  'butter': 'Dairy & Eggs',
  'egg': 'Dairy & Eggs',
  'yogurt': 'Dairy & Eggs',
  'cream': 'Dairy & Eggs',

  // 调料
  'seasoning': 'Spices & Seasonings',
  'salt': 'Spices & Seasonings',
  'pepper': 'Spices & Seasonings',
  'spice': 'Spices & Seasonings',
  'cumin': 'Spices & Seasonings',
  'oregano': 'Spices & Seasonings',
  'basil': 'Spices & Seasonings',
  'thyme': 'Spices & Seasonings',
  'paprika': 'Spices & Seasonings',
  'cinnamon': 'Spices & Seasonings',

  // 酱料
  'sauce': 'Condiments & Sauces',
  'soy sauce': 'Condiments & Sauces',
  'vinegar': 'Condiments & Sauces',
  'oil': 'Condiments & Sauces',
  'mayo': 'Condiments & Sauces',
  'ketchup': 'Condiments & Sauces',
  'mustard': 'Condiments & Sauces',
  'honey': 'Condiments & Sauces',

  // 谷物
  'grain': 'Pasta, Rice & Grains',
  'rice': 'Pasta, Rice & Grains',
  'pasta': 'Pasta, Rice & Grains',
  'noodle': 'Pasta, Rice & Grains',
  'bread': 'Bakery',
  'flour': 'Baking',

  // 罐头
  'canned': 'Canned Goods',
  'beans': 'Canned Goods',
  'tomato sauce': 'Canned Goods',
  'broth': 'Canned Goods',
  'stock': 'Canned Goods',

  // 冷冻
  'frozen': 'Frozen Foods',

  // 其他
  'tofu': 'Refrigerated',
  'default': 'Other'
};

/**
 * 根据食材名称判断过道
 * @param {string} ingredientName - 食材名称
 * @param {string} [category] - 分类
 * @returns {string} 过道名称
 */
function getAisle(ingredientName, category) {
  const name = ingredientName.toLowerCase();

  // 先检查分类
  if (category && AISLE_MAPPING[category.toLowerCase()]) {
    return AISLE_MAPPING[category.toLowerCase()];
  }

  // 检查名称中的关键词
  for (const [keyword, aisle] of Object.entries(AISLE_MAPPING)) {
    if (name.includes(keyword)) {
      return aisle;
    }
  }

  return AISLE_MAPPING.default;
}

// =============================================================================
// groceries.merge_by_store_aisle
// =============================================================================

/**
 * 合并配料并按过道分组
 *
 * @param {Object[]} ingredients - 配料列表
 * @param {string} ingredients[].name - 食材名称
 * @param {number} ingredients[].qty - 数量
 * @param {string} [ingredients[].unit] - 单位
 * @param {string} [ingredients[].category] - 分类
 * @param {Object} [options]
 * @param {import('../types/api.js').PantryItem[]} [options.pantry] - 库存
 * @returns {import('../types/api.js').GroceryListByAisle[]}
 */
export function mergeByStoreAisle(ingredients, options = {}) {
  const { pantry = [] } = options;

  // 创建库存映射（用于扣减）
  const pantryMap = new Map();
  for (const item of pantry) {
    const key = item.name.toLowerCase();
    const existing = pantryMap.get(key) || 0;
    pantryMap.set(key, existing + (item.qty_est_lower || 0));
  }

  // 合并相同食材
  const merged = new Map();
  for (const ing of ingredients) {
    const key = ing.name.toLowerCase();
    const existing = merged.get(key);

    if (existing) {
      // 合并数量（需要单位兼容）
      if (existing.unit === ing.unit || !ing.unit) {
        existing.qty += ing.qty || 0;
      } else {
        // 单位不同，暂时简单累加
        existing.qty += ing.qty || 0;
        existing.unit = existing.unit || ing.unit;
      }
    } else {
      merged.set(key, {
        name: ing.name,
        qty: ing.qty || 0,
        unit: ing.unit,
        category: ing.category,
        aisle: getAisle(ing.name, ing.category)
      });
    }
  }

  // 扣减库存
  for (const [key, item] of merged) {
    const inPantry = pantryMap.get(key) || 0;
    if (inPantry > 0) {
      item.qty = Math.max(0, item.qty - inPantry);
      if (item.qty === 0) {
        merged.delete(key);
      }
    }
  }

  // 按过道分组
  const aisleGroups = new Map();
  for (const item of merged.values()) {
    const aisle = item.aisle;
    if (!aisleGroups.has(aisle)) {
      aisleGroups.set(aisle, []);
    }
    aisleGroups.get(aisle).push({
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      aisle: item.aisle,
      checked: false
    });
  }

  // 转换为数组格式，按过道名称排序
  const result = [];
  const sortedAisles = [...aisleGroups.keys()].sort();
  for (const aisle of sortedAisles) {
    result.push({
      aisle,
      items: aisleGroups.get(aisle).sort((a, b) => a.name.localeCompare(b.name))
    });
  }

  return result;
}

/**
 * 生成"还差清单"
 *
 * @param {import('../types/api.js').GroceryListByAisle[]} originalList - 原始清单
 * @param {string[]} checkedItems - 已勾选的食材名称
 * @returns {import('../types/api.js').GroceryListByAisle[]}
 */
export function getRemainingList(originalList, checkedItems) {
  const checkedSet = new Set(checkedItems.map(i => i.toLowerCase()));

  return originalList
    .map(group => ({
      aisle: group.aisle,
      items: group.items.filter(item => !checkedSet.has(item.name.toLowerCase()))
    }))
    .filter(group => group.items.length > 0);
}

export default {
  mergeByStoreAisle,
  getRemainingList
};

