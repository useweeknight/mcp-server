/**
 * MCP 工具：intent_normalizer
 *
 * 将用户自然语言输入转换为结构化的 Dinner-DSL。
 * 使用 OpenAI Responses API 进行意图解析。
 */

import OpenAI from 'openai';

/** @type {OpenAI | null} */
let openai = null;

/**
 * 获取 OpenAI 客户端（懒加载）
 * @returns {OpenAI}
 */
function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY environment variable');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

/**
 * 意图解析的系统提示
 */
const SYSTEM_PROMPT = `You are a dinner planning assistant. Parse the user's natural language input into a structured Dinner-DSL.

Output JSON with these fields:
{
  "dsl": {
    "time_max": number (minutes, default 30),
    "dish_count_max": number (default 1),
    "cookware_max": number (default 3),
    "oil_level": number (0-3, 0=no oil, 1=light, 2=normal, 3=heavy),
    "spice_level": number (0-3, 0=none, 1=mild, 2=medium, 3=hot),
    "cook_type": string[] (e.g. ["one-pot", "stir-fry", "air-fry", "steam", "boil", "sheet-pan"]),
    "equipment": string[] (e.g. ["air-fryer", "sheet-pan", "instant-pot"]),
    "family": {
      "kid_friendly": boolean
    },
    "must_use": string[] (ingredients to use),
    "avoid": string[] (ingredients to avoid),
    "cuisine": string[] (e.g. ["chinese", "italian", "mexican"])
  },
  "confidence": {
    "field_name": number (0-1)
  },
  "clarifying_question": string or null
}

Rules:
- If "清淡" or "light": oil_level=0-1, spice_level=0-1
- If "孩子能吃" or "kid-friendly": kid_friendly=true, spice_level=0
- If "少洗碗" or "one pot": cookware_max=1-2, prefer one-pot/sheet-pan
- If "快" or "≤30分钟": time_max=30 or less
- If ingredients mentioned with "用掉/用/有": add to must_use
- Only ask clarifying_question if critical info is missing AND affects executability
- Most inputs should result in clarifying_question=null`;

/**
 * 解析用户意图
 *
 * @param {string} textInput - 用户自然语言输入
 * @returns {Promise<import('../types/api.js').IntentNormalizerResult>}
 */
export async function intentNormalizer(textInput) {
  const client = getOpenAI();

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: textInput }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const parsed = JSON.parse(content);

    // 确保有默认值
    const dsl = {
      time_max: 30,
      dish_count_max: 1,
      cookware_max: 3,
      oil_level: 1,
      spice_level: 0,
      cook_type: [],
      equipment: [],
      family: { kid_friendly: false },
      must_use: [],
      avoid: [],
      cuisine: [],
      ...parsed.dsl
    };

    return {
      dsl,
      confidence: parsed.confidence || {},
      clarifying_question: parsed.clarifying_question || null
    };
  } catch (error) {
    console.error('[intent_normalizer] Error:', error);

    // 降级：返回保守默认值
    return {
      dsl: {
        time_max: 30,
        dish_count_max: 1,
        cookware_max: 3,
        oil_level: 1,
        spice_level: 0,
        cook_type: ['one-pot', 'steam'],
        equipment: [],
        family: { kid_friendly: false },
        must_use: [],
        avoid: [],
        cuisine: ['chinese', 'japanese', 'italian']
      },
      confidence: { fallback: 1 },
      clarifying_question: null
    };
  }
}

export default intentNormalizer;

