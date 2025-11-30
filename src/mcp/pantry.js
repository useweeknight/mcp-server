/**
 * MCP 工具：pantry
 *
 * 库存操作：search / add / consume
 * 所有写操作携带 idempotency_key，并记录 audit_logs。
 */

import { randomUUID } from 'crypto';

/**
 * 获取 Supabase 客户端
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */

// =============================================================================
// pantry.search
// =============================================================================

/**
 * 搜索库存
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} householdId - 家庭 ID
 * @param {Object} [options]
 * @param {string} [options.query] - 搜索关键词
 * @param {string} [options.category] - 分类筛选
 * @param {boolean} [options.expiring_soon] - 是否只显示即将过期的
 * @returns {Promise<import('../types/api.js').PantryItem[]>}
 */
export async function pantrySearch(supabase, householdId, options = {}) {
  let query = supabase
    .from('pantry_items')
    .select('*')
    .eq('household_id', householdId)
    .order('expire_on', { ascending: true, nullsFirst: false });

  if (options.query) {
    query = query.ilike('name', `%${options.query}%`);
  }

  if (options.category) {
    query = query.eq('category', options.category);
  }

  if (options.expiring_soon) {
    // 3 天内过期
    const threeDaysLater = new Date();
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);
    query = query.lte('expire_on', threeDaysLater.toISOString().split('T')[0]);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[pantry.search] Error:', error);
    throw error;
  }

  return data || [];
}

// =============================================================================
// pantry.add
// =============================================================================

/**
 * 添加库存项
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} householdId - 家庭 ID
 * @param {string} userId - 操作用户 ID
 * @param {Object} item - 库存项
 * @param {string} item.name - 食材名称
 * @param {number} [item.qty_est_lower] - 数量下界
 * @param {number} [item.qty_est_upper] - 数量上界
 * @param {string} [item.unit] - 单位
 * @param {number} [item.confidence] - 置信度
 * @param {string} [item.expire_on] - 过期日期
 * @param {string} [item.source] - 来源
 * @param {string} [item.category] - 分类
 * @param {string} [idempotencyKey] - 幂等键
 * @returns {Promise<import('../types/api.js').PantryItem>}
 */
export async function pantryAdd(supabase, householdId, userId, item, idempotencyKey) {
  const key = idempotencyKey || randomUUID();

  // 检查幂等键是否已使用
  const { data: existing } = await supabase
    .from('compensation_log')
    .select('entity_id')
    .eq('idempotency_key', key)
    .eq('tool', 'pantry.add')
    .single();

  if (existing?.entity_id) {
    // 返回已创建的记录
    const { data } = await supabase
      .from('pantry_items')
      .select('*')
      .eq('id', existing.entity_id)
      .single();
    return data;
  }

  // 创建新记录
  const newItem = {
    id: randomUUID(),
    household_id: householdId,
    name: item.name,
    qty_est_lower: item.qty_est_lower,
    qty_est_upper: item.qty_est_upper,
    unit: item.unit,
    confidence: item.confidence ?? 0.8,
    expire_on: item.expire_on,
    source: item.source || 'manual',
    category: item.category
  };

  const { data, error } = await supabase
    .from('pantry_items')
    .insert(newItem)
    .select()
    .single();

  if (error) {
    console.error('[pantry.add] Error:', error);
    throw error;
  }

  // 记录到 compensation_log
  await supabase.from('compensation_log').insert({
    user_id: userId,
    household_id: householdId,
    tool: 'pantry.add',
    operation: 'INSERT',
    entity_type: 'pantry_items',
    entity_id: data.id,
    before_snapshot: null,
    after_snapshot: data,
    idempotency_key: key
  });

  // 记录到 audit_logs
  await supabase.from('audit_logs').insert({
    actor_user_id: userId,
    entity: 'pantry_items',
    entity_id: data.id,
    action: 'create',
    before_value: null,
    after_value: data
  });

  return data;
}

// =============================================================================
// pantry.consume
// =============================================================================

/**
 * 消费库存（支持 dry_run 模式）
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} householdId - 家庭 ID
 * @param {string} userId - 操作用户 ID
 * @param {Object[]} consumption - 消费列表
 * @param {string} consumption[].name - 食材名称
 * @param {number} consumption[].qty - 消费数量
 * @param {string} [consumption[].unit] - 单位
 * @param {Object} [options]
 * @param {boolean} [options.dry_run] - 是否为预演模式
 * @param {string} [options.idempotency_key] - 幂等键
 * @returns {Promise<{ success: boolean, shortages: Object[], consumed: Object[] }>}
 */
export async function pantryConsume(supabase, householdId, userId, consumption, options = {}) {
  const { dry_run = false, idempotency_key } = options;
  const key = idempotency_key || randomUUID();

  // 获取当前库存
  const { data: pantryItems, error } = await supabase
    .from('pantry_items')
    .select('*')
    .eq('household_id', householdId);

  if (error) {
    console.error('[pantry.consume] Error fetching pantry:', error);
    throw error;
  }

  const shortages = [];
  const consumed = [];

  for (const item of consumption) {
    // 查找匹配的库存项（模糊匹配名称）
    const pantryItem = (pantryItems || []).find(p =>
      p.name.toLowerCase().includes(item.name.toLowerCase()) ||
      item.name.toLowerCase().includes(p.name.toLowerCase())
    );

    if (!pantryItem) {
      shortages.push({
        name: item.name,
        required: item.qty,
        available: 0,
        unit: item.unit
      });
      continue;
    }

    const available = pantryItem.qty_est_lower || 0;
    if (available < item.qty) {
      shortages.push({
        name: item.name,
        required: item.qty,
        available,
        unit: item.unit || pantryItem.unit
      });
    } else {
      consumed.push({
        id: pantryItem.id,
        name: item.name,
        qty: item.qty,
        unit: item.unit || pantryItem.unit,
        remaining: available - item.qty
      });
    }
  }

  // 如果是 dry_run，直接返回结果
  if (dry_run) {
    return {
      success: shortages.length === 0,
      shortages,
      consumed
    };
  }

  // 实际执行扣减
  for (const item of consumed) {
    const pantryItem = (pantryItems || []).find(p => p.id === item.id);
    if (!pantryItem) continue;

    const newLower = Math.max(0, (pantryItem.qty_est_lower || 0) - item.qty);
    const newUpper = Math.max(0, (pantryItem.qty_est_upper || 0) - item.qty);

    // 如果扣减后为 0，删除记录；否则更新
    if (newLower <= 0 && newUpper <= 0) {
      await supabase
        .from('pantry_items')
        .delete()
        .eq('id', item.id);

      // 记录删除
      await supabase.from('compensation_log').insert({
        user_id: userId,
        household_id: householdId,
        tool: 'pantry.consume',
        operation: 'DELETE',
        entity_type: 'pantry_items',
        entity_id: item.id,
        before_snapshot: pantryItem,
        after_snapshot: null,
        idempotency_key: key
      });
    } else {
      const updated = {
        qty_est_lower: newLower,
        qty_est_upper: newUpper
      };

      await supabase
        .from('pantry_items')
        .update(updated)
        .eq('id', item.id);

      // 记录更新
      await supabase.from('compensation_log').insert({
        user_id: userId,
        household_id: householdId,
        tool: 'pantry.consume',
        operation: 'UPDATE',
        entity_type: 'pantry_items',
        entity_id: item.id,
        before_snapshot: pantryItem,
        after_snapshot: { ...pantryItem, ...updated },
        idempotency_key: key
      });
    }

    // 审计日志
    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      entity: 'pantry_items',
      entity_id: item.id,
      action: 'consume',
      before_value: pantryItem,
      after_value: { consumed_qty: item.qty }
    });
  }

  return {
    success: shortages.length === 0,
    shortages,
    consumed
  };
}

export default {
  search: pantrySearch,
  add: pantryAdd,
  consume: pantryConsume
};

