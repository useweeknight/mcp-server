/**
 * Admin Flags API - 内容标签/风险标签管理
 *
 * 用于给菜谱打上「烘焙高风险 / 生食敏感 / 孩子不爱」等运营标签
 * 注意：这与 feature_flags（功能开关）不同！
 *
 * - feature_flags：控制冷启动、emoji 反馈、AB 实验等功能开关
 * - content_flags：给菜谱打标签，服务于推荐策略和前端提示
 */

import { Router } from 'express';

const router = Router();

/**
 * 内容标签定义
 * 实际应用中可以存储在数据库中，这里先使用配置方式
 */
const defaultContentFlags = [
  {
    id: 'baking_sensitive',
    key: 'baking_sensitive',
    name: '烘焙高风险',
    name_en: 'Baking Sensitive',
    description: '涉及烘焙工艺，替代可能影响成品质量',
    scope: 'recipe',
    severity: 'high',
    enabled: true,
    requires_confirmation: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z'
  },
  {
    id: 'raw_food',
    key: 'raw_food',
    name: '生食敏感',
    name_en: 'Raw Food',
    description: '包含生食或半熟食材，需提醒食品安全',
    scope: 'recipe',
    severity: 'high',
    enabled: true,
    requires_confirmation: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z'
  },
  {
    id: 'kid_dislike',
    key: 'kid_dislike',
    name: '孩子不爱',
    name_en: 'Kid Dislike',
    description: '用户反馈孩子不喜欢的菜品',
    scope: 'recipe',
    severity: 'low',
    enabled: true,
    requires_confirmation: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z'
  },
  {
    id: 'high_salt',
    key: 'high_salt',
    name: '口味过咸',
    name_en: 'High Salt',
    description: '含盐量较高，不适合低钠饮食',
    scope: 'recipe',
    severity: 'medium',
    enabled: true,
    requires_confirmation: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z'
  },
  {
    id: 'spicy_warning',
    key: 'spicy_warning',
    name: '辣度警告',
    name_en: 'Spicy Warning',
    description: '辣度较高，需提醒用户',
    scope: 'recipe',
    severity: 'medium',
    enabled: true,
    requires_confirmation: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z'
  },
  {
    id: 'emulsification_risk',
    key: 'emulsification_risk',
    name: '乳化敏感',
    name_en: 'Emulsification Risk',
    description: '涉及乳化工艺，替代可能导致分层',
    scope: 'recipe',
    severity: 'high',
    enabled: true,
    requires_confirmation: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z'
  }
];

// 内存存储（生产环境应该使用数据库）
let contentFlags = [...defaultContentFlags];

/**
 * 写入审计日志
 */
async function writeAuditLog(supabase, actorUserId, action, before, after, traceId) {
  try {
    await supabase.from('audit_logs').insert({
      actor_user_id: actorUserId,
      entity: 'content_flag',
      entity_id: after?.id || before?.id || 'unknown',
      action,
      before: before ? JSON.stringify(before) : null,
      after: after ? JSON.stringify(after) : null,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[admin/flags] Failed to write audit log:', error.message);
  }
}

/**
 * GET /admin/flags
 * 获取所有内容标签配置
 */
router.get('/', async (req, res) => {
  try {
    const { scope, severity, enabled } = req.query;

    let filtered = [...contentFlags];

    // 按 scope 筛选
    if (scope) {
      filtered = filtered.filter(f => f.scope === scope);
    }

    // 按 severity 筛选
    if (severity) {
      filtered = filtered.filter(f => f.severity === severity);
    }

    // 按 enabled 筛选
    if (enabled !== undefined) {
      const isEnabled = enabled === 'true';
      filtered = filtered.filter(f => f.enabled === isEnabled);
    }

    res.json({
      ok: true,
      data: filtered,
      total: filtered.length,
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

/**
 * GET /admin/flags/:id
 * 获取单个内容标签
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const flag = contentFlags.find(f => f.id === id);

    if (!flag) {
      return res.status(404).json({
        ok: false,
        message: '内容标签不存在',
        trace_id: req.traceId
      });
    }

    res.json({
      ok: true,
      data: flag,
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

/**
 * POST /admin/flags
 * 新增内容标签
 */
router.post('/', async (req, res) => {
  try {
    const { key, name, name_en, description, scope, severity, enabled, requires_confirmation } = req.body;

    // 验证必填字段
    if (!key || !name) {
      return res.status(400).json({
        ok: false,
        message: '缺少必填字段: key, name',
        trace_id: req.traceId
      });
    }

    // 检查 key 是否已存在
    if (contentFlags.some(f => f.key === key)) {
      return res.status(400).json({
        ok: false,
        message: '标签 key 已存在',
        trace_id: req.traceId
      });
    }

    const now = new Date().toISOString();
    const newFlag = {
      id: key, // 使用 key 作为 id
      key,
      name,
      name_en: name_en || name,
      description: description || '',
      scope: scope || 'recipe',
      severity: severity || 'medium',
      enabled: enabled !== false,
      requires_confirmation: requires_confirmation || false,
      created_at: now,
      updated_at: now
    };

    contentFlags.push(newFlag);

    // 写入审计日志
    await writeAuditLog(req.supabase, req.adminUser.id, 'create', null, newFlag, req.traceId);

    res.status(201).json({
      ok: true,
      data: newFlag,
      message: '内容标签创建成功',
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

/**
 * PUT /admin/flags/:id
 * 修改内容标签
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, name_en, description, scope, severity, enabled, requires_confirmation } = req.body;

    const index = contentFlags.findIndex(f => f.id === id);
    if (index === -1) {
      return res.status(404).json({
        ok: false,
        message: '内容标签不存在',
        trace_id: req.traceId
      });
    }

    const before = { ...contentFlags[index] };
    const now = new Date().toISOString();

    // 更新字段
    if (name !== undefined) contentFlags[index].name = name;
    if (name_en !== undefined) contentFlags[index].name_en = name_en;
    if (description !== undefined) contentFlags[index].description = description;
    if (scope !== undefined) contentFlags[index].scope = scope;
    if (severity !== undefined) contentFlags[index].severity = severity;
    if (enabled !== undefined) contentFlags[index].enabled = enabled;
    if (requires_confirmation !== undefined) contentFlags[index].requires_confirmation = requires_confirmation;
    contentFlags[index].updated_at = now;

    const after = { ...contentFlags[index] };

    // 写入审计日志
    await writeAuditLog(req.supabase, req.adminUser.id, 'update', before, after, req.traceId);

    res.json({
      ok: true,
      data: after,
      message: '内容标签更新成功',
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

/**
 * DELETE /admin/flags/:id
 * 删除内容标签（软删除：标记为禁用）
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const index = contentFlags.findIndex(f => f.id === id);
    if (index === -1) {
      return res.status(404).json({
        ok: false,
        message: '内容标签不存在',
        trace_id: req.traceId
      });
    }

    const before = { ...contentFlags[index] };

    // 软删除：标记为禁用并移除
    contentFlags.splice(index, 1);

    // 写入审计日志
    await writeAuditLog(req.supabase, req.adminUser.id, 'delete', before, null, req.traceId);

    res.json({
      ok: true,
      message: '内容标签已删除',
      trace_id: req.traceId
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message, trace_id: req.traceId });
  }
});

export default router;

