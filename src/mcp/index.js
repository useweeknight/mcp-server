/**
 * MCP 工具集统一导出
 *
 * 按 MCP 规范注册所有工具，提供统一的工具调用入口。
 */

import { intentNormalizer } from './intentNormalizer.js';
import pantry from './pantry.js';
import recipes from './recipes.js';
import subs from './subs.js';
import groceries from './groceries.js';
import nutrition from './nutrition.js';

// =============================================================================
// 工具清单（按产品书定义）
// =============================================================================

/**
 * MCP 工具元信息
 */
export const MCP_TOOLS = {
  intent_normalizer: {
    name: 'intent_normalizer',
    description: '将用户自然语言输入转换为 Dinner-DSL',
    scope: 'recipes.read',
    handler: intentNormalizer
  },
  'pantry.search': {
    name: 'pantry.search',
    description: '搜索家庭库存',
    scope: 'pantry.read',
    handler: pantry.search
  },
  'pantry.add': {
    name: 'pantry.add',
    description: '添加库存项',
    scope: 'pantry.write',
    handler: pantry.add
  },
  'pantry.consume': {
    name: 'pantry.consume',
    description: '消费库存（支持 dry_run 模式）',
    scope: 'pantry.write',
    handler: pantry.consume
  },
  'recipes.search': {
    name: 'recipes.search',
    description: '搜索菜谱，按产品书规则排序',
    scope: 'recipes.read',
    handler: recipes.search
  },
  'subs.suggest': {
    name: 'subs.suggest',
    description: '为缺失配料提供替代建议',
    scope: 'subs.read',
    handler: subs.suggest
  },
  'groceries.merge_by_store_aisle': {
    name: 'groceries.merge_by_store_aisle',
    description: '合并配料并按过道分组',
    scope: 'groceries.read',
    handler: groceries.mergeByStoreAisle
  },
  'nutrition.lookup': {
    name: 'nutrition.lookup',
    description: '查询食材营养信息',
    scope: 'nutrition.read',
    handler: nutrition.lookup
  }
};

// =============================================================================
// 工具调用入口
// =============================================================================

/**
 * 调用 MCP 工具
 *
 * @param {string} toolName - 工具名称
 * @param {Object} params - 参数
 * @param {Object} context - 上下文（包含 supabase 客户端等）
 * @returns {Promise<Object>}
 */
export async function callTool(toolName, params, context) {
  const tool = MCP_TOOLS[toolName];

  if (!tool) {
    throw new Error(`Unknown MCP tool: ${toolName}`);
  }

  const startTime = Date.now();

  try {
    const result = await tool.handler(params, context);
    return {
      ok: true,
      data: result,
      duration_ms: Date.now() - startTime
    };
  } catch (error) {
    console.error(`[MCP] Tool ${toolName} failed:`, error);
    return {
      ok: false,
      error: error.message,
      duration_ms: Date.now() - startTime
    };
  }
}

// =============================================================================
// 导出所有工具
// =============================================================================

export {
  intentNormalizer,
  pantry,
  recipes,
  subs,
  groceries,
  nutrition
};

export default {
  tools: MCP_TOOLS,
  call: callTool,
  intentNormalizer,
  pantry,
  recipes,
  subs,
  groceries,
  nutrition
};

