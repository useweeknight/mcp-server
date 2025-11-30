/**
 * Pantry API 路由
 *
 * POST /api/pantry/ocr - 库存 OCR 识别
 *
 * 当前阶段使用 mock 数据实现，后续接 OpenAI Vision API。
 */

import { Router } from 'express';
import { recordSchemaViolation } from '../middleware/metrics.js';

const router = Router();

// =============================================================================
// Mock OCR 识别结果
// =============================================================================

/**
 * 模拟 OCR 识别结果
 * 根据图片"内容"（实际是随机生成）返回库存项
 */
const MOCK_OCR_RESULTS = [
  {
    name: 'Chicken Breast',
    qty_est_range: { lower: 400, upper: 500 },
    unit: 'g',
    confidence: 0.92,
    category: 'protein'
  },
  {
    name: 'Spinach',
    qty_est_range: { lower: 150, upper: 200 },
    unit: 'g',
    confidence: 0.88,
    category: 'vegetable'
  },
  {
    name: 'Eggs',
    qty_est_range: { lower: 6, upper: 6 },
    unit: 'pieces',
    confidence: 0.95,
    category: 'dairy'
  },
  {
    name: 'Milk',
    qty_est_range: { lower: 500, upper: 600 },
    unit: 'ml',
    confidence: 0.85,
    category: 'dairy'
  },
  {
    name: 'Rice',
    qty_est_range: { lower: 800, upper: 1000 },
    unit: 'g',
    confidence: 0.78,
    category: 'grain'
  },
  {
    name: 'Onion',
    qty_est_range: { lower: 2, upper: 3 },
    unit: 'pieces',
    confidence: 0.90,
    category: 'vegetable'
  },
  {
    name: 'Garlic',
    qty_est_range: { lower: 4, upper: 6 },
    unit: 'cloves',
    confidence: 0.82,
    category: 'vegetable'
  },
  {
    name: 'Olive Oil',
    qty_est_range: { lower: 200, upper: 300 },
    unit: 'ml',
    confidence: 0.75,
    category: 'condiment'
  },
  {
    name: 'Soy Sauce',
    qty_est_range: { lower: 150, upper: 200 },
    unit: 'ml',
    confidence: 0.80,
    category: 'condiment'
  },
  {
    name: 'Broccoli',
    qty_est_range: { lower: 200, upper: 300 },
    unit: 'g',
    confidence: 0.87,
    category: 'vegetable'
  }
];

/**
 * 随机选择 3-6 个 mock 结果
 * @returns {Object[]}
 */
function getRandomMockResults() {
  const count = Math.floor(Math.random() * 4) + 3; // 3-6 个
  const shuffled = [...MOCK_OCR_RESULTS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// =============================================================================
// POST /api/pantry/ocr
// =============================================================================

/**
 * 库存 OCR 识别
 *
 * @route POST /api/pantry/ocr
 * @body {Object}
 * @body.image {string} - Base64 编码的图片（支持 image/png, image/jpeg）
 * @body.userId {string} - 用户 ID（可选，用于日志）
 * @returns {{ ok: boolean, items: PantryItem[], _isMock: boolean }}
 */
router.post('/ocr', async (req, res) => {
  const traceId = req.traceId;

  try {
    const { image, userId } = req.body;

    // 验证图片
    if (!image) {
      recordSchemaViolation('/api/pantry/ocr');
      return res.status(400).json({
        ok: false,
        message: 'Missing image data',
        trace_id: traceId
      });
    }

    // 验证 base64 格式
    const isValidBase64 = /^data:image\/(png|jpeg|jpg);base64,/.test(image) ||
                          /^[A-Za-z0-9+/=]+$/.test(image.slice(0, 100));

    if (!isValidBase64) {
      recordSchemaViolation('/api/pantry/ocr');
      return res.status(400).json({
        ok: false,
        message: 'Invalid image format. Expected base64 encoded image.',
        trace_id: traceId
      });
    }

    console.log(`[Pantry OCR] Processing image for user=${userId || 'anonymous'}, size=${image.length} chars`);

    // TODO: 接入真实的 OpenAI Vision API
    // const items = await processWithVisionAPI(image);

    // 当前使用 mock 数据
    const items = getRandomMockResults();

    console.log(`[Pantry OCR] Identified ${items.length} items (mock)`);

    return res.json({
      ok: true,
      items,
      trace_id: traceId,
      _isMock: true,
      _note: 'This is mock data. Real OCR will be implemented in a future step.'
    });

  } catch (error) {
    console.error('[Pantry OCR] Error:', error);

    return res.status(500).json({
      ok: false,
      message: error.message || 'Failed to process image',
      trace_id: traceId
    });
  }
});

// =============================================================================
// POST /api/pantry/ocr/confirm
// =============================================================================

/**
 * 确认 OCR 识别结果并添加到库存
 *
 * @route POST /api/pantry/ocr/confirm
 * @body {Object}
 * @body.userId {string} - 用户 ID
 * @body.items {Object[]} - 要添加的库存项（来自 OCR 结果）
 * @returns {{ ok: boolean, added: number }}
 */
router.post('/ocr/confirm', async (req, res) => {
  const traceId = req.traceId;

  try {
    const { userId, items } = req.body;

    if (!userId) {
      recordSchemaViolation('/api/pantry/ocr/confirm');
      return res.status(400).json({
        ok: false,
        message: 'Missing userId',
        trace_id: traceId
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      recordSchemaViolation('/api/pantry/ocr/confirm');
      return res.status(400).json({
        ok: false,
        message: 'Missing or empty items array',
        trace_id: traceId
      });
    }

    const supabase = req.supabase;

    if (!supabase) {
      return res.status(500).json({
        ok: false,
        message: 'Database not available',
        trace_id: traceId
      });
    }

    // 获取用户的 household_id
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!membership?.household_id) {
      return res.status(400).json({
        ok: false,
        message: 'User has no household',
        trace_id: traceId
      });
    }

    const householdId = membership.household_id;

    // 批量添加库存项
    const pantryItems = items.map(item => ({
      household_id: householdId,
      name: item.name,
      qty_est_lower: item.qty_est_range?.lower,
      qty_est_upper: item.qty_est_range?.upper,
      unit: item.unit,
      confidence: item.confidence,
      category: item.category,
      source: 'ocr'
    }));

    const { error } = await supabase
      .from('pantry_items')
      .insert(pantryItems);

    if (error) {
      console.error('[Pantry OCR Confirm] Insert error:', error);
      return res.status(500).json({
        ok: false,
        message: 'Failed to add items to pantry',
        trace_id: traceId
      });
    }

    console.log(`[Pantry OCR Confirm] Added ${items.length} items for household=${householdId}`);

    return res.json({
      ok: true,
      added: items.length,
      trace_id: traceId
    });

  } catch (error) {
    console.error('[Pantry OCR Confirm] Error:', error);

    return res.status(500).json({
      ok: false,
      message: error.message || 'Failed to confirm OCR results',
      trace_id: traceId
    });
  }
});

export default router;

