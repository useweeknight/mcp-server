/**
 * Realtime API 配置
 *
 * 预埋图像通道，为未来 iOS 端通过 Realtime 发送图片做准备。
 * 当前 UI 先走 HTTP /api/pantry/ocr，后续再切换为 Realtime。
 */

// =============================================================================
// 模型配置
// =============================================================================

/**
 * 可用的 Realtime 模型
 */
export const REALTIME_MODELS = {
  // 标准语音模型
  standard: 'gpt-4o-realtime-preview-2024-12-17',
  // 带视觉的模型（预留）
  vision: 'gpt-4o-realtime-preview-2024-12-17'
};

// =============================================================================
// 语音配置
// =============================================================================

/**
 * 可用的语音选项
 */
export const VOICE_OPTIONS = {
  alloy: 'alloy',      // 中性、平衡
  echo: 'echo',        // 男性
  fable: 'fable',      // 英式
  onyx: 'onyx',        // 深沉男性
  nova: 'nova',        // 女性
  shimmer: 'shimmer'   // 女性、温暖
};

/**
 * 默认语音
 */
export const DEFAULT_VOICE = 'alloy';

// =============================================================================
// 音频格式配置
// =============================================================================

/**
 * 支持的音频格式
 */
export const AUDIO_FORMATS = {
  pcm16: 'pcm16',           // 16-bit PCM
  g711_ulaw: 'g711_ulaw',   // G.711 μ-law
  g711_alaw: 'g711_alaw'    // G.711 A-law
};

/**
 * 默认音频格式
 */
export const DEFAULT_AUDIO_FORMAT = 'pcm16';

// =============================================================================
// 模态配置
// =============================================================================

/**
 * 支持的模态
 */
export const MODALITIES = {
  text: 'text',
  audio: 'audio',
  image: 'image'  // 预留图像模态
};

/**
 * 默认启用的模态（当前不包含图像）
 */
export const DEFAULT_MODALITIES = ['text', 'audio'];

/**
 * 启用视觉的模态配置
 */
export const VISION_MODALITIES = ['text', 'audio', 'image'];

// =============================================================================
// 语音命令配置
// =============================================================================

/**
 * 支持的语音命令
 * 用于无接触烹饪模式
 */
export const VOICE_COMMANDS = {
  // 基础控制
  start: {
    triggers: ['start', 'begin', 'go', 'let\'s start', 'let\'s go'],
    action: 'START_COOKING'
  },
  next: {
    triggers: ['next', 'next step', 'continue', 'done', 'finished'],
    action: 'NEXT_STEP'
  },
  previous: {
    triggers: ['previous', 'back', 'go back', 'last step'],
    action: 'PREVIOUS_STEP'
  },
  repeat: {
    triggers: ['repeat', 'say again', 'what was that', 'one more time'],
    action: 'REPEAT_INSTRUCTION'
  },
  pause: {
    triggers: ['pause', 'stop', 'wait', 'hold on'],
    action: 'PAUSE_TIMER'
  },
  resume: {
    triggers: ['resume', 'continue', 'start again'],
    action: 'RESUME_TIMER'
  },

  // 计时器控制
  addTime: {
    triggers: ['+1 minute', 'add one minute', 'plus one minute', 'add a minute'],
    action: 'ADD_TIME',
    params: { seconds: 60 }
  },
  setTimer: {
    triggers: ['set timer', 'set for', 'timer for'],
    action: 'SET_TIMER',
    params: { parse: true } // 需要解析时间
  },

  // 紧急修复
  panicFix: {
    triggers: ['panic fix', 'help', 'oh no', 'it\'s burning', 'too salty', 'too bland'],
    action: 'PANIC_FIX'
  }
};

// =============================================================================
// Session 配置模板
// =============================================================================

/**
 * 获取基础 session 配置
 * @param {Object} options
 * @param {string} [options.voice] - 语音选项
 * @param {string[]} [options.modalities] - 模态
 * @returns {Object}
 */
export function getBaseSessionConfig(options = {}) {
  return {
    model: REALTIME_MODELS.standard,
    voice: options.voice || DEFAULT_VOICE,
    modalities: options.modalities || DEFAULT_MODALITIES,
    input_audio_format: DEFAULT_AUDIO_FORMAT,
    output_audio_format: DEFAULT_AUDIO_FORMAT,
    input_audio_transcription: {
      model: 'whisper-1'
    }
  };
}

/**
 * 获取烹饪模式 session 配置
 * @param {Object} recipeContext - 菜谱上下文
 * @returns {Object}
 */
export function getCookingSessionConfig(recipeContext = {}) {
  const { recipeName, currentStep, totalSteps } = recipeContext;

  return {
    ...getBaseSessionConfig(),
    instructions: `You are a cooking assistant helping the user prepare "${recipeName || 'their meal'}".
Current progress: Step ${currentStep || 1} of ${totalSteps || '?'}.

Respond to voice commands:
- "next" → Move to next step
- "repeat" → Repeat current instruction
- "pause" → Pause timer
- "+1 minute" → Add time to timer
- "panic fix" → Provide troubleshooting

Keep responses concise (1-2 sentences) for hands-free cooking.
Use clear, encouraging language.`
  };
}

/**
 * 获取库存识别 session 配置（预留）
 * @returns {Object}
 */
export function getPantryOCRSessionConfig() {
  return {
    ...getBaseSessionConfig({ modalities: VISION_MODALITIES }),
    model: REALTIME_MODELS.vision,
    instructions: `You are a pantry inventory assistant.
When shown an image of food items:
1. Identify each visible item
2. Estimate quantity and appropriate unit
3. Categorize (protein/vegetable/dairy/grain/condiment)
4. Rate your confidence (0-1)

Respond with a JSON array of items.`
  };
}

// =============================================================================
// WebSocket 配置
// =============================================================================

/**
 * WebSocket 连接配置
 */
export const WS_CONFIG = {
  // OpenAI Realtime WebSocket 端点
  endpoint: 'wss://api.openai.com/v1/realtime',

  // 重连配置
  reconnect: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000
  },

  // 心跳配置
  heartbeat: {
    interval: 30000, // 30 秒
    timeout: 5000
  }
};

export default {
  REALTIME_MODELS,
  VOICE_OPTIONS,
  AUDIO_FORMATS,
  MODALITIES,
  VOICE_COMMANDS,
  WS_CONFIG,
  getBaseSessionConfig,
  getCookingSessionConfig,
  getPantryOCRSessionConfig
};

