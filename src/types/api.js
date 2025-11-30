/**
 * Weeknight API 类型定义
 *
 * 使用 JSDoc 定义类型，供全项目复用。
 * 后续可渐进迁移到 TypeScript。
 *
 * @fileoverview 统一导出类型定义，对齐 ops-config/supabase/schema.sql
 */

// =============================================================================
// Dinner-DSL（意图解析结果）
// =============================================================================

/**
 * 意图解析后的结构化表示
 * @typedef {Object} DinnerDSL
 * @property {number} [time_max] - 最大烹饪时间（分钟）
 * @property {number} [dish_count_max] - 最大菜品数量
 * @property {number} [cookware_max] - 最大锅具数量
 * @property {number} [oil_level] - 油量等级 (0-3)
 * @property {number} [spice_level] - 辣度等级 (0-3)
 * @property {string[]} [cook_type] - 烹饪方式（one-pot/stir-fry/air-fry/steam/...）
 * @property {string[]} [equipment] - 偏好器具（air-fryer/sheet-pan/...）
 * @property {FamilyPrefs} [family] - 家庭偏好
 * @property {string[]} [must_use] - 必须使用的食材
 * @property {string[]} [avoid] - 避免的食材
 * @property {string[]} [cuisine] - 偏好菜系
 */

/**
 * 家庭偏好
 * @typedef {Object} FamilyPrefs
 * @property {boolean} [kid_friendly] - 儿童友好
 * @property {string[]} [diet_restrictions] - 饮食限制
 */

/**
 * 意图解析结果
 * @typedef {Object} IntentNormalizerResult
 * @property {DinnerDSL} dsl - 结构化意图
 * @property {Object<string, number>} confidence - 各字段置信度
 * @property {string|null} clarifying_question - 需要澄清的问题
 */

// =============================================================================
// 库存 & 剩菜
// =============================================================================

/**
 * 库存项（对应 pantry_items 表）
 * @typedef {Object} PantryItem
 * @property {string} id - UUID
 * @property {string} household_id - 家庭 ID
 * @property {string} name - 食材名称
 * @property {number} [qty_est_lower] - 数量下界
 * @property {number} [qty_est_upper] - 数量上界
 * @property {string} [unit] - 单位（g/ml/个/块/袋等）
 * @property {number} [confidence] - 置信度 (0-1)
 * @property {string} [expire_on] - 过期日期（ISO 日期字符串）
 * @property {string} [source] - 来源（manual/voice/ocr）
 * @property {string} [category] - 分类
 * @property {string} created_at - 创建时间
 * @property {string} updated_at - 更新时间
 */

/**
 * 库存快照（简化版，用于 API 入参）
 * @typedef {Object} PantrySnapshot
 * @property {string} name - 食材名称
 * @property {{ lower: number, upper: number }} qty_est_range - 数量范围
 * @property {string} [unit] - 单位
 */

/**
 * 剩菜项（对应 leftovers 表）
 * @typedef {Object} LeftoverItem
 * @property {string} id - UUID
 * @property {string} household_id - 家庭 ID
 * @property {string} [recipe_id] - 关联菜谱 ID
 * @property {string} name - 剩菜名称
 * @property {number} servings - 剩余份数
 * @property {string} created_at - 创建时间
 * @property {string} safe_until - 安全期限
 * @property {string} [note] - 备注
 * @property {boolean} is_consumed - 是否已消费
 * @property {string} [consumed_at] - 消费时间
 */

// =============================================================================
// 菜谱 & 时间线
// =============================================================================

/**
 * 菜谱（对应 recipe 表）
 * @typedef {Object} Recipe
 * @property {string} id - UUID
 * @property {string} slug - URL 友好标识
 * @property {string} title - 菜名
 * @property {string} [title_zh] - 中文菜名
 * @property {string} [description] - 简介
 * @property {string[]} [cook_type] - 烹饪方式
 * @property {string[]} [equipment] - 所需器具
 * @property {number} [cookware_count] - 锅具数量
 * @property {number} [time_prep_min] - 准备时间
 * @property {number} [time_cook_min] - 烹饪时间
 * @property {number} [time_total_min] - 总时间
 * @property {number} [servings] - 默认份数
 * @property {string} [difficulty] - 难度（easy/medium/hard）
 * @property {number} [oil_level] - 油量等级
 * @property {number} [spice_level] - 辣度等级
 * @property {boolean} [kid_friendly] - 儿童友好
 * @property {string[]} [tags] - 标签
 * @property {string} [cuisine] - 菜系
 * @property {string} [hero_image_url] - 主图 URL
 * @property {string} status - 状态（draft/published/archived）
 */

/**
 * 建议卡（用于 Tonight 页面展示）
 * @typedef {Object} SuggestionCard
 * @property {string} recipe_id - 菜谱 ID
 * @property {string} title - 菜名
 * @property {string} [hero_image_url] - 主图
 * @property {number} time_total_min - 总时间
 * @property {number} cookware_count - 锅具数量
 * @property {number} servings - 份数
 * @property {string[]} tags - 标签
 * @property {boolean} kid_friendly - 儿童友好
 * @property {string[]} equipment - 器具
 * @property {SubstitutionApplied[]} [substitutions_applied] - 已应用的替代
 * @property {LeftoverPotential} [leftover_potential] - 剩菜潜力
 * @property {NutritionInfo} [nutrition] - 营养信息
 * @property {number} score - 匹配分数
 * @property {string[]} rank_reasons - 排序原因
 */

/**
 * 已应用的替代
 * @typedef {Object} SubstitutionApplied
 * @property {string} original - 原配料
 * @property {string} substitute - 替代品
 * @property {string} level - 替代级别（allowable/risky/baking_sensitive）
 */

/**
 * 剩菜潜力
 * @typedef {Object} LeftoverPotential
 * @property {boolean} suitable - 是否适合留剩菜
 * @property {string} [transformation] - 次日变形建议
 * @property {number} safe_hours - 安全保存小时数
 */

/**
 * 时间线步骤（用于无接触烹饪）
 * @typedef {Object} TimelineStep
 * @property {string} id - 步骤 ID
 * @property {number} step_order - 步骤顺序
 * @property {string} instruction - 步骤说明
 * @property {string} [instruction_zh] - 中文说明
 * @property {number} [duration_sec] - 预计耗时（秒）
 * @property {number} [timer_sec] - 计时器时长（秒）
 * @property {string} [method] - 动作类型
 * @property {string} [equipment] - 所用器具
 * @property {string} [concurrent_group] - 并行组标识
 * @property {string} [cleanup_hint] - 清理提示
 * @property {number} [temperature_f] - 温度（华氏度）
 * @property {string} [doneness_cue] - 完成指标
 * @property {string[]} [icon_keys] - 图标键
 * @property {string} [panic_fix] - 紧急修复提示
 */

/**
 * 配菜
 * @typedef {Object} SideDish
 * @property {string} name - 配菜名称
 * @property {number} time_min - 预计时长（分钟）
 * @property {string[]} equipment - 使用器具
 * @property {string[]} steps - 简短步骤（2-3 个）
 * @property {string} [insert_window] - 可插入的等待窗口
 */

// =============================================================================
// Step Icon Card（步骤图标卡）
// =============================================================================

/**
 * 步骤图标卡（按菜谱库 v1.0 定义）
 * @typedef {Object} StepIconCard
 * @property {string} step_id - 步骤 ID
 * @property {string[]} icon_keys - 图标键
 * @property {string} title - 标题
 * @property {string} subtitle - 副标题
 * @property {string[]} badges - 徽章（并行/翻面等）
 * @property {string[]} cues - 提示（温度/完成指标）
 */

// =============================================================================
// 营养信息
// =============================================================================

/**
 * 营养信息（对应 nutrition_snapshot 表）
 * @typedef {Object} NutritionInfo
 * @property {number} [calories_kcal] - 热量
 * @property {number} [protein_g] - 蛋白质（克）
 * @property {number} [fat_g] - 脂肪（克）
 * @property {number} [carbs_g] - 碳水（克）
 * @property {number} [fiber_g] - 纤维（克）
 * @property {number} [sodium_mg] - 钠（毫克）
 * @property {boolean} [retention_applied] - 是否应用了烹饪损失系数
 * @property {number} [confidence_pct] - 置信度百分比
 * @property {string} [source] - 数据来源（usda/manual/estimated/mock）
 */

/**
 * 营养查询入参
 * @typedef {Object} NutritionLookupInput
 * @property {string} ingredient - 食材名称
 * @property {number} [qty] - 数量
 * @property {string} [unit] - 单位
 */

/**
 * 营养查询结果
 * @typedef {Object} NutritionLookupResult
 * @property {string} ingredient - 食材名称
 * @property {NutritionInfo} nutrition - 营养信息
 * @property {boolean} cached - 是否来自缓存
 */

// =============================================================================
// 替代
// =============================================================================

/**
 * 替代建议入参
 * @typedef {Object} SubsSuggestInput
 * @property {string} recipe_id - 菜谱 ID
 * @property {string[]} missing - 缺失的配料
 * @property {Object} [context] - 上下文
 * @property {string[]} [context.diet] - 饮食限制
 * @property {string} [context.risk] - 风险偏好（low/medium/high）
 */

/**
 * 替代建议结果
 * @typedef {Object} SubstitutionSuggestion
 * @property {string} original_ingredient - 原配料
 * @property {string} substitute_ingredient - 替代品
 * @property {string} level - 级别（allowable/risky/baking_sensitive）
 * @property {number} ratio - 替换比例
 * @property {number} delta_timeline_sec - 时间调整（秒）
 * @property {Object} delta_nutrition - 营养变化
 * @property {string} [notes] - 备注
 */

// =============================================================================
// 购物清单
// =============================================================================

/**
 * 购物清单项
 * @typedef {Object} GroceryItem
 * @property {string} name - 食材名称
 * @property {number} qty - 数量
 * @property {string} unit - 单位
 * @property {string} [aisle] - 过道/分区
 * @property {boolean} [checked] - 是否已勾选
 */

/**
 * 按过道分组的购物清单
 * @typedef {Object} GroceryListByAisle
 * @property {string} aisle - 过道名称
 * @property {GroceryItem[]} items - 该过道的商品
 */

// =============================================================================
// Telemetry（埋点）
// =============================================================================

/**
 * 埋点事件类型
 * @typedef {'card_view' | 'card_click' | 'card_select' | 'cook_start' | 'cook_complete' |
 *           'cook_pause' | 'cook_resume' | 'step_skip' | 'step_repeat' | 'panic_fix' |
 *           'leftover_mark' | 'share' | 'emoji_good' | 'emoji_neutral' | 'emoji_bad'} TelemetryEventType
 */

/**
 * 埋点载荷
 * @typedef {Object} TelemetryPayload
 * @property {TelemetryEventType} event - 事件类型
 * @property {string} [recipe_id] - 菜谱 ID
 * @property {string} [user_id] - 用户 ID
 * @property {string} [household_id] - 家庭 ID
 * @property {Object} [context] - 上下文信息
 * @property {string} [trace_id] - 追踪 ID
 * @property {number} [timestamp] - 时间戳
 */

// =============================================================================
// Tonight API
// =============================================================================

/**
 * Tonight API 入参
 * @typedef {Object} TonightInput
 * @property {string} user_id - 用户 ID
 * @property {string} text_input - 用户自然语言输入
 * @property {PantrySnapshot[]} [pantry_snapshot] - 可选库存快照
 */

/**
 * Tonight API 出参
 * @typedef {Object} TonightOutput
 * @property {SuggestionCard[]} suggestions - 建议卡列表（2-3 张）
 * @property {TimelineStep[]} [timeline] - 选中菜谱的时间线
 * @property {SideDish[]} [side_dishes] - 可选配菜
 * @property {string} trace_id - 追踪 ID
 * @property {number} decision_time_ms - 决策耗时（毫秒）
 */

// =============================================================================
// 通用
// =============================================================================

/**
 * API 错误响应
 * @typedef {Object} ApiError
 * @property {boolean} ok - 总是 false
 * @property {string} message - 错误信息
 * @property {string} [code] - 错误代码
 * @property {string} [trace_id] - 追踪 ID
 */

/**
 * 分页参数
 * @typedef {Object} PaginationParams
 * @property {number} [page] - 页码（从 1 开始）
 * @property {number} [limit] - 每页数量（默认 20）
 */

/**
 * 分页响应
 * @template T
 * @typedef {Object} PaginatedResponse
 * @property {T[]} data - 数据列表
 * @property {number} total - 总数
 * @property {number} page - 当前页
 * @property {number} limit - 每页数量
 * @property {boolean} has_more - 是否有更多
 */

// 导出空对象，使其成为一个模块
export default {};

