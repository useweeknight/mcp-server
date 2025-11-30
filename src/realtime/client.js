/**
 * OpenAI Realtime API 客户端封装
 *
 * 用于生成 Realtime session 的短期 token。
 * 客户端使用这个 token 直接连接 OpenAI Realtime WebSocket。
 *
 * 参考：https://platform.openai.com/docs/guides/realtime
 */

import OpenAI from 'openai';

/** @type {OpenAI | null} */
let openai = null;

/**
 * 获取 OpenAI 客户端（懒加载）
 * @returns {OpenAI | null}
 */
function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // 开发/测试环境允许无 API key
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        console.warn('[Realtime] No OPENAI_API_KEY, will use placeholder tokens');
        return null;
      }
      throw new Error('Missing OPENAI_API_KEY environment variable');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

// =============================================================================
// Realtime Session 配置
// =============================================================================

/**
 * Realtime session 默认配置
 * @type {Object}
 */
const DEFAULT_SESSION_CONFIG = {
  model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
  // 语音配置
  voice: 'alloy',
  // 输入模式：文本 + 音频
  input_audio_format: 'pcm16',
  output_audio_format: 'pcm16',
  // 输入音频转录
  input_audio_transcription: {
    model: 'whisper-1'
  },
  // 工具配置（预留）
  tools: [],
  // 允许的消息类型（预埋图像通道）
  modalities: ['text', 'audio'],
  // 系统指令
  instructions: `You are a helpful cooking assistant for the Weeknight app.
You help users with dinner planning and cooking guidance.
Voice commands you should understand:
- "start" - Start cooking or timer
- "next" - Go to next step
- "repeat" - Repeat current instruction
- "pause" - Pause timer
- "+1min" or "add one minute" - Add 1 minute to timer
- "set N minutes" - Set timer to N minutes
- "panic fix" or "help" - Provide troubleshooting for common cooking issues
Respond in a friendly, concise manner suitable for hands-free cooking.`
};

/**
 * 获取 Realtime session 配置
 * @param {Object} [overrides] - 配置覆盖
 * @returns {Object}
 */
export function getSessionConfig(overrides = {}) {
  return {
    ...DEFAULT_SESSION_CONFIG,
    ...overrides
  };
}

// =============================================================================
// 创建 Realtime Session
// =============================================================================

/**
 * 创建 Realtime session 并获取 ephemeral token
 *
 * OpenAI Realtime API 流程：
 * 1. 后端调用 POST /v1/realtime/sessions 创建 session
 * 2. 获取 ephemeral token（短期有效，通常 1 分钟）
 * 3. 客户端使用 token 连接 WebSocket
 *
 * @param {Object} options
 * @param {string} [options.userId] - 用户 ID（用于日志）
 * @param {Object} [options.sessionConfig] - 会话配置覆盖
 * @returns {Promise<{ token: string, model: string, expiresAt: string, wsUrl: string }>}
 */
export async function createRealtimeSession(options = {}) {
  const { userId, sessionConfig = {} } = options;
  const config = getSessionConfig(sessionConfig);

  // 检查 OpenAI 客户端是否可用
  const client = getOpenAI();
  if (!client) {
    // 开发/测试环境返回占位 token
    console.warn('[Realtime] Using placeholder token (no API key)');
    return createPlaceholderSession(config.model, userId);
  }

  try {
    // 调用 OpenAI REST API 创建 Realtime session
    // 注意：这个 API 端点可能需要根据 OpenAI 最新文档调整
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        voice: config.voice,
        instructions: config.instructions,
        input_audio_format: config.input_audio_format,
        output_audio_format: config.output_audio_format,
        input_audio_transcription: config.input_audio_transcription,
        modalities: config.modalities
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Realtime] Session creation failed:', response.status, errorText);

      // 如果 API 不可用，返回占位 token（用于开发测试）
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        console.warn('[Realtime] Using placeholder token for development');
        return createPlaceholderSession(config.model, userId);
      }

      throw new Error(`Failed to create Realtime session: ${response.status}`);
    }

    const data = await response.json();

    console.log(`[Realtime] Session created for user=${userId || 'anonymous'}`);

    return {
      token: data.client_secret?.value || data.token || data.id,
      model: config.model,
      expiresAt: data.client_secret?.expires_at || new Date(Date.now() + 60000).toISOString(),
      wsUrl: `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.model)}`
    };
  } catch (error) {
    console.error('[Realtime] Error creating session:', error);

    // 开发环境降级
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      console.warn('[Realtime] Falling back to placeholder token');
      return createPlaceholderSession(config.model, userId);
    }

    throw error;
  }
}

/**
 * 创建占位 session（用于开发测试）
 * @param {string} model
 * @param {string} [userId]
 * @returns {{ token: string, model: string, expiresAt: string, wsUrl: string }}
 */
function createPlaceholderSession(model, userId) {
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  return {
    token: `placeholder-token-${Date.now()}-${userId || 'anon'}`,
    model,
    expiresAt,
    wsUrl: `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    _isPlaceholder: true
  };
}

// =============================================================================
// 预埋：图像通道配置
// =============================================================================

/**
 * 获取支持图像输入的 session 配置
 *
 * 预埋：未来 iOS 端可以通过 Realtime 发送图片用于库存识别。
 * 当前 UI 先走 HTTP /api/pantry/ocr，后续再切换为 Realtime。
 *
 * @returns {Object}
 */
export function getVisionEnabledConfig() {
  return {
    ...DEFAULT_SESSION_CONFIG,
    // 启用视觉模态（需要支持视觉的模型）
    modalities: ['text', 'audio', 'image'],
    model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
    instructions: `${DEFAULT_SESSION_CONFIG.instructions}

When the user shares an image of their pantry or ingredients:
1. Identify all visible food items
2. Estimate quantities and units
3. Report them in a structured format for inventory tracking`
  };
}

export default {
  createSession: createRealtimeSession,
  getSessionConfig,
  getVisionEnabledConfig
};

