/**
 * Cook Routes - 烹饪会话管理
 *
 * POST /cook/start - 创建烹饪会话，返回 session_id 和初始 TimelineStep[]
 * GET /cook/events - SSE 推送烹饪事件（计时器、步骤状态）
 * POST /cook/action - 发送控制指令（next/prev/pause/resume/+1min 等）
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';

const router = Router();

// =============================================================================
// 内存存储（MVP 阶段，后续可迁移到 Redis/DB）
// =============================================================================

/**
 * @typedef {Object} CookSession
 * @property {string} session_id
 * @property {string} user_id
 * @property {string} recipe_id
 * @property {number} current_step - 当前步骤索引（0-based）
 * @property {'idle'|'cooking'|'paused'|'completed'} status
 * @property {number} timer_remaining_sec - 当前计时器剩余秒数（无计时器时为 0）
 * @property {number} timer_started_at - 计时器开始时间戳
 * @property {TimelineStep[]} steps - 时间线步骤
 * @property {number} created_at
 * @property {number} updated_at
 */

/** @type {Map<string, CookSession>} */
const sessions = new Map();

/** @type {Map<string, Set<import('express').Response>>} SSE 客户端连接 */
const sseClients = new Map();

// =============================================================================
// Mock 时间线数据（后续从 recipes API 获取）
// =============================================================================

function getMockTimeline(recipeId) {
  return [
    {
      id: `${recipeId}-step-1`,
      step_order: 1,
      instruction: 'Gather all ingredients and prep your workspace.',
      instruction_zh: '准备所有食材和工作台',
      duration_sec: 120,
      timer_sec: 0,
      method: 'prep',
      equipment: 'cutting board',
      icon_keys: ['prep', 'knife']
    },
    {
      id: `${recipeId}-step-2`,
      step_order: 2,
      instruction: 'Chop the onions and garlic finely.',
      instruction_zh: '切碎洋葱和大蒜',
      duration_sec: 180,
      timer_sec: 0,
      method: 'chop',
      equipment: 'knife',
      icon_keys: ['knife', 'onion']
    },
    {
      id: `${recipeId}-step-3`,
      step_order: 3,
      instruction: 'Heat oil in a large pan over medium-high heat.',
      instruction_zh: '在大平底锅中用中高火加热油',
      duration_sec: 60,
      timer_sec: 60,
      method: 'heat',
      equipment: 'pan',
      temperature_f: 350,
      icon_keys: ['pan', 'fire']
    },
    {
      id: `${recipeId}-step-4`,
      step_order: 4,
      instruction: 'Sauté onions until translucent, about 3 minutes.',
      instruction_zh: '炒洋葱直到透明，约3分钟',
      duration_sec: 180,
      timer_sec: 180,
      method: 'sauté',
      equipment: 'pan',
      doneness_cue: 'Onions should be translucent',
      icon_keys: ['pan', 'stir']
    },
    {
      id: `${recipeId}-step-5`,
      step_order: 5,
      instruction: 'Add garlic and cook for 30 seconds until fragrant.',
      instruction_zh: '加入大蒜炒30秒直到出香味',
      duration_sec: 30,
      timer_sec: 30,
      method: 'sauté',
      equipment: 'pan',
      icon_keys: ['garlic', 'timer']
    },
    {
      id: `${recipeId}-step-6`,
      step_order: 6,
      instruction: 'Add main protein and cook until done.',
      instruction_zh: '加入主料并烹饪至熟',
      duration_sec: 480,
      timer_sec: 480,
      method: 'cook',
      equipment: 'pan',
      doneness_cue: 'Internal temp 165°F for chicken',
      icon_keys: ['pan', 'thermometer']
    },
    {
      id: `${recipeId}-step-7`,
      step_order: 7,
      instruction: 'Plate and serve immediately. Enjoy!',
      instruction_zh: '装盘并立即享用！',
      duration_sec: 60,
      timer_sec: 0,
      method: 'plate',
      equipment: 'plate',
      cleanup_hint: 'Let pan cool before washing',
      icon_keys: ['plate', 'serve']
    }
  ];
}

// =============================================================================
// SSE 广播辅助函数
// =============================================================================

function broadcastToSession(sessionId, event, data) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try {
      res.write(message);
    } catch {
      // 客户端断开连接
    }
  });
}

// =============================================================================
// 计时器管理
// =============================================================================

/** @type {Map<string, NodeJS.Timeout>} */
const timerIntervals = new Map();

function startTimer(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.timer_remaining_sec <= 0) return;

  // 清除已有计时器
  stopTimer(sessionId);

  session.timer_started_at = Date.now();
  session.status = 'cooking';
  sessions.set(sessionId, session);

  const interval = setInterval(() => {
    const s = sessions.get(sessionId);
    if (!s || s.status !== 'cooking') {
      stopTimer(sessionId);
      return;
    }

    s.timer_remaining_sec--;

    // 广播 timer_tick
    broadcastToSession(sessionId, 'timer_tick', {
      session_id: sessionId,
      remaining_sec: s.timer_remaining_sec,
      current_step: s.current_step
    });

    if (s.timer_remaining_sec <= 0) {
      // 计时器完成
      stopTimer(sessionId);
      broadcastToSession(sessionId, 'timer_done', {
        session_id: sessionId,
        step_order: s.steps[s.current_step]?.step_order
      });
    }

    sessions.set(sessionId, s);
  }, 1000);

  timerIntervals.set(sessionId, interval);
}

function stopTimer(sessionId) {
  const interval = timerIntervals.get(sessionId);
  if (interval) {
    clearInterval(interval);
    timerIntervals.delete(sessionId);
  }
}

function pauseTimer(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  stopTimer(sessionId);
  session.status = 'paused';
  sessions.set(sessionId, session);
}

function resumeTimer(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'paused') return;

  if (session.timer_remaining_sec > 0) {
    startTimer(sessionId);
  } else {
    session.status = 'cooking';
    sessions.set(sessionId, session);
  }
}

// =============================================================================
// POST /cook/start - 创建烹饪会话
// =============================================================================

router.post('/start', async (req, res) => {
  try {
    const { recipe_id, user_id, variant_id, leftover_mode } = req.body;

    if (!recipe_id) {
      return res.status(400).json({
        ok: false,
        message: 'recipe_id is required'
      });
    }

    // 生成 session ID
    const session_id = randomUUID();

    // 获取时间线（后续从 Supabase 获取真实数据）
    let steps;
    if (req.supabase) {
      // 尝试从数据库获取
      const { data, error } = await req.supabase
        .from('recipe_step')
        .select('*')
        .eq('recipe_id', recipe_id)
        .order('step_order', { ascending: true });

      if (!error && data && data.length > 0) {
        steps = data;
      } else {
        // Fallback to mock
        steps = getMockTimeline(recipe_id);
      }
    } else {
      steps = getMockTimeline(recipe_id);
    }

    // 创建会话
    /** @type {CookSession} */
    const session = {
      session_id,
      user_id: user_id || 'anonymous',
      recipe_id,
      variant_id: variant_id || null,
      leftover_mode: leftover_mode || false,
      current_step: 0,
      status: 'idle',
      timer_remaining_sec: steps[0]?.timer_sec || 0,
      timer_started_at: 0,
      steps,
      created_at: Date.now(),
      updated_at: Date.now()
    };

    sessions.set(session_id, session);

    res.json({
      ok: true,
      session_id,
      steps,
      current_step: 0,
      status: 'idle',
      timer_sec: steps[0]?.timer_sec || 0
    });
  } catch (error) {
    console.error('[/cook/start] Error:', error);
    res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// GET /cook/events - SSE 事件流
// =============================================================================

router.get('/events', (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({
      ok: false,
      message: 'Invalid or missing session_id'
    });
  }

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx buffering off

  // 发送初始连接确认
  res.write(`event: connected\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`);

  // 注册客户端
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  sseClients.get(sessionId).add(res);

  // 发送当前状态
  const session = sessions.get(sessionId);
  if (session) {
    res.write(`event: state_sync\ndata: ${JSON.stringify({
      session_id: session.session_id,
      current_step: session.current_step,
      status: session.status,
      timer_remaining_sec: session.timer_remaining_sec,
      step: session.steps[session.current_step]
    })}\n\n`);
  }

  // Keep-alive ping
  const pingInterval = setInterval(() => {
    try {
      res.write(':ping\n\n');
    } catch {
      // 客户端断开
    }
  }, 30000);

  // 清理
  req.on('close', () => {
    clearInterval(pingInterval);
    const clients = sseClients.get(sessionId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(sessionId);
      }
    }
  });
});

// =============================================================================
// POST /cook/action - 发送控制指令
// =============================================================================

router.post('/action', (req, res) => {
  try {
    const { session_id, action, value } = req.body;

    if (!session_id) {
      return res.status(400).json({
        ok: false,
        message: 'session_id is required'
      });
    }

    const session = sessions.get(session_id);
    if (!session) {
      return res.status(404).json({
        ok: false,
        message: 'Session not found'
      });
    }

    let message = '';

    switch (action) {
      case 'start':
        session.status = 'cooking';
        if (session.timer_remaining_sec > 0) {
          startTimer(session_id);
        }
        message = 'Cooking started';
        broadcastToSession(session_id, 'step_started', {
          session_id,
          step_order: session.steps[session.current_step]?.step_order,
          step: session.steps[session.current_step]
        });
        break;

      case 'next':
        if (session.current_step < session.steps.length - 1) {
          stopTimer(session_id);
          // 广播步骤完成
          broadcastToSession(session_id, 'step_completed', {
            session_id,
            step_order: session.steps[session.current_step]?.step_order
          });

          session.current_step++;
          session.timer_remaining_sec = session.steps[session.current_step]?.timer_sec || 0;

          // 广播新步骤开始
          broadcastToSession(session_id, 'step_started', {
            session_id,
            step_order: session.steps[session.current_step]?.step_order,
            step: session.steps[session.current_step]
          });

          // 如果新步骤有计时器且状态为 cooking，自动启动
          if (session.status === 'cooking' && session.timer_remaining_sec > 0) {
            startTimer(session_id);
          }

          message = `Moved to step ${session.current_step + 1}`;
        } else {
          // 完成所有步骤
          stopTimer(session_id);
          session.status = 'completed';
          broadcastToSession(session_id, 'cook_complete', {
            session_id,
            total_steps: session.steps.length
          });
          message = 'Cooking completed!';
        }
        break;

      case 'prev':
        if (session.current_step > 0) {
          stopTimer(session_id);
          session.current_step--;
          session.timer_remaining_sec = session.steps[session.current_step]?.timer_sec || 0;
          broadcastToSession(session_id, 'step_started', {
            session_id,
            step_order: session.steps[session.current_step]?.step_order,
            step: session.steps[session.current_step]
          });
          message = `Moved to step ${session.current_step + 1}`;
        }
        break;

      case 'pause':
        pauseTimer(session_id);
        broadcastToSession(session_id, 'paused', { session_id });
        message = 'Timer paused';
        break;

      case 'resume':
        resumeTimer(session_id);
        broadcastToSession(session_id, 'resumed', { session_id });
        message = 'Timer resumed';
        break;

      case 'add_time':
        // 增加时间（默认 60 秒，或传入 value）
        const addSec = parseInt(value, 10) || 60;
        session.timer_remaining_sec += addSec;
        broadcastToSession(session_id, 'timer_adjusted', {
          session_id,
          added_sec: addSec,
          remaining_sec: session.timer_remaining_sec
        });
        message = `Added ${addSec} seconds`;
        break;

      case 'set_time':
        // 设置指定时间
        const setSec = parseInt(value, 10);
        if (!isNaN(setSec) && setSec >= 0) {
          session.timer_remaining_sec = setSec;
          broadcastToSession(session_id, 'timer_adjusted', {
            session_id,
            set_sec: setSec,
            remaining_sec: session.timer_remaining_sec
          });
          message = `Timer set to ${setSec} seconds`;
        }
        break;

      case 'repeat':
        // 重复当前步骤说明
        broadcastToSession(session_id, 'instruction_repeat', {
          session_id,
          step: session.steps[session.current_step]
        });
        message = 'Instruction repeated';
        break;

      case 'stop':
        // 结束烹饪
        stopTimer(session_id);
        session.status = 'completed';
        broadcastToSession(session_id, 'cook_stopped', { session_id });
        // 清理会话
        setTimeout(() => sessions.delete(session_id), 60000); // 1 分钟后清理
        message = 'Cooking stopped';
        break;

      default:
        return res.status(400).json({
          ok: false,
          message: `Unknown action: ${action}`
        });
    }

    session.updated_at = Date.now();
    sessions.set(session_id, session);

    res.json({
      ok: true,
      message,
      current_step: session.current_step,
      status: session.status,
      timer_remaining_sec: session.timer_remaining_sec
    });
  } catch (error) {
    console.error('[/cook/action] Error:', error);
    res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: req.traceId
    });
  }
});

// =============================================================================
// GET /cook/session/:id - 获取会话状态
// =============================================================================

router.get('/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({
      ok: false,
      message: 'Session not found'
    });
  }

  res.json({
    ok: true,
    data: {
      session_id: session.session_id,
      recipe_id: session.recipe_id,
      current_step: session.current_step,
      status: session.status,
      timer_remaining_sec: session.timer_remaining_sec,
      steps: session.steps,
      current_step_data: session.steps[session.current_step]
    }
  });
});

export default router;

