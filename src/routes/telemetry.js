/**
 * Telemetry 路由
 *
 * POST /telemetry - 接收前端/iOS 上报的使用数据
 *
 * 数据写入 recipe_signal 表，用于支撑以下指标：
 * - hero_hit_rate
 * - card_generation_coverage
 * - nutrition_completeness
 * - handsfree_completion
 * - leftover_consumption_rate
 */

import { Router } from 'express';
import { recordSchemaViolation, recordLeftoverConsumption } from '../middleware/metrics.js';

const router = Router();

// =============================================================================
// 有效事件类型
// =============================================================================

const VALID_EVENTS = new Set([
  // 卡片相关
  'card_view',
  'card_click',
  'card_select',

  // 烹饪相关
  'cook_start',
  'cook_complete',
  'cook_pause',
  'cook_resume',
  'step_skip',
  'step_repeat',
  'panic_fix',

  // 剩菜相关
  'leftover_mark',
  'leftover_consume',

  // 反馈相关
  'emoji_good',
  'emoji_neutral',
  'emoji_bad',
  'kid_dislike',

  // 分享相关
  'share',

  // 其他
  'view',
  'save',
  'repeat'
]);

// 事件类型到 signal_type 的映射
const EVENT_TO_SIGNAL = {
  'card_view': 'view',
  'card_click': 'click',
  'card_select': 'select',
  'cook_start': 'cook_start',
  'cook_complete': 'cook_complete',
  'leftover_mark': 'save',
  'leftover_consume': 'repeat',
  'emoji_good': 'emoji_good',
  'emoji_neutral': 'emoji_neutral',
  'emoji_bad': 'emoji_bad',
  'kid_dislike': 'kid_dislike',
  'share': 'share',
  'save': 'save',
  'repeat': 'repeat'
};

// =============================================================================
// POST /telemetry
// =============================================================================

/**
 * 接收埋点数据
 *
 * @route POST /telemetry
 * @body {TelemetryPayload} - 埋点数据
 */
router.post('/', async (req, res) => {
  const traceId = req.traceId;

  try {
    const { event, recipe_id, user_id, household_id, context, timestamp } = req.body;

    // 验证事件类型
    if (!event || !VALID_EVENTS.has(event)) {
      recordSchemaViolation('/telemetry');
      return res.status(400).json({
        ok: false,
        message: `Invalid event type: ${event}`,
        valid_events: [...VALID_EVENTS],
        trace_id: traceId
      });
    }

    // 验证 user_id（必须）
    if (!user_id) {
      recordSchemaViolation('/telemetry');
      return res.status(400).json({
        ok: false,
        message: 'Missing user_id',
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

    // 映射到 signal_type
    const signalType = EVENT_TO_SIGNAL[event] || event;

    // 构建上下文信息
    const signalContext = {
      ...context,
      original_event: event,
      trace_id: traceId,
      client_timestamp: timestamp || Date.now()
    };

    // 写入 recipe_signal 表
    if (recipe_id) {
      const { error } = await supabase.from('recipe_signal').insert({
        recipe_id,
        user_id,
        household_id: household_id || null,
        signal_type: signalType,
        context: signalContext
      });

      if (error) {
        console.error('[telemetry] Error inserting signal:', error);
        // 不返回错误，因为埋点失败不应影响用户体验
      }
    }

    // 更新指标
    if (event === 'leftover_consume') {
      recordLeftoverConsumption(true);
    } else if (event === 'leftover_mark') {
      recordLeftoverConsumption(false);
    }

    // 返回成功（即使写入失败也返回成功，避免影响客户端）
    return res.status(202).json({
      ok: true,
      trace_id: traceId
    });

  } catch (error) {
    console.error('[telemetry] Error:', error);
    // 埋点接口不返回 500 错误
    return res.status(202).json({
      ok: true,
      trace_id: traceId,
      _warning: 'Processing error occurred but data may still be recorded'
    });
  }
});

// =============================================================================
// POST /telemetry/batch
// =============================================================================

/**
 * 批量接收埋点数据
 *
 * @route POST /telemetry/batch
 * @body {TelemetryPayload[]} events - 埋点数据数组
 */
router.post('/batch', async (req, res) => {
  const traceId = req.traceId;

  try {
    const { events } = req.body;

    if (!Array.isArray(events)) {
      return res.status(400).json({
        ok: false,
        message: 'events must be an array',
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

    // 过滤并转换有效事件
    const validSignals = events
      .filter(e => e.event && VALID_EVENTS.has(e.event) && e.user_id && e.recipe_id)
      .map(e => ({
        recipe_id: e.recipe_id,
        user_id: e.user_id,
        household_id: e.household_id || null,
        signal_type: EVENT_TO_SIGNAL[e.event] || e.event,
        context: {
          ...e.context,
          original_event: e.event,
          trace_id: traceId,
          client_timestamp: e.timestamp || Date.now()
        }
      }));

    // 批量插入
    if (validSignals.length > 0) {
      const { error } = await supabase.from('recipe_signal').insert(validSignals);

      if (error) {
        console.error('[telemetry/batch] Error inserting signals:', error);
      }
    }

    return res.status(202).json({
      ok: true,
      received: events.length,
      processed: validSignals.length,
      trace_id: traceId
    });

  } catch (error) {
    console.error('[telemetry/batch] Error:', error);
    return res.status(202).json({
      ok: true,
      trace_id: traceId,
      _warning: 'Processing error occurred'
    });
  }
});

export default router;

