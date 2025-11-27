-- ==========================================================================
-- Weeknight · Supabase Schema (PostgreSQL)
-- ==========================================================================
-- 版本：v1.0
-- 日期：2025-11-26
-- 说明：定义所有核心表结构与 RLS 策略
--       以《菜谱库_产品说明_v1.0.md》和《ADMIN.md》为标准
-- ==========================================================================

-- 启用必要扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================================================
-- 1. 用户 & 家庭
-- ==========================================================================

-- 用户表（扩展 Supabase auth.users）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'operator', 'support')),
  locale TEXT DEFAULT 'en-US',
  timezone TEXT DEFAULT 'America/Los_Angeles',
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 家庭表
CREATE TABLE IF NOT EXISTS households (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  settings JSONB DEFAULT '{
    "kid_friendly": false,
    "max_cookware": 3,
    "default_servings": 2,
    "diet_restrictions": []
  }',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 家庭成员表（用户与家庭的关联）
CREATE TABLE IF NOT EXISTS household_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (household_id, user_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_household_members_user ON household_members(user_id);
CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);

-- ==========================================================================
-- 2. 库存 & 剩菜
-- ==========================================================================

-- 库存表（按家庭隔离）
CREATE TABLE IF NOT EXISTS pantry_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty_est_lower NUMERIC,           -- 数量下界
  qty_est_upper NUMERIC,           -- 数量上界
  unit TEXT,                       -- 单位（g/ml/个/块/袋等）
  confidence NUMERIC DEFAULT 0.8,  -- 置信度 (0-1)
  expire_on DATE,                  -- 过期日期
  source TEXT DEFAULT 'manual',    -- 来源（manual/voice/ocr）
  category TEXT,                   -- 分类（蔬菜/肉类/调料等）
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pantry_household ON pantry_items(household_id);
CREATE INDEX IF NOT EXISTS idx_pantry_expire ON pantry_items(expire_on);
CREATE INDEX IF NOT EXISTS idx_pantry_name ON pantry_items(name);

-- 剩菜表（按家庭隔离）
CREATE TABLE IF NOT EXISTS leftovers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recipe_id UUID,                  -- 关联菜谱（可空）
  name TEXT NOT NULL,              -- 剩菜名称
  servings NUMERIC DEFAULT 1,      -- 剩余份数
  created_at TIMESTAMPTZ DEFAULT now(),
  safe_until TIMESTAMPTZ NOT NULL, -- 安全期限（48-72h）
  note TEXT,
  is_consumed BOOLEAN DEFAULT FALSE,
  consumed_at TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_leftovers_household ON leftovers(household_id);
CREATE INDEX IF NOT EXISTS idx_leftovers_safe_until ON leftovers(safe_until);

-- ==========================================================================
-- 3. 菜谱库
-- ==========================================================================

-- 菜谱主表
CREATE TABLE IF NOT EXISTS recipe (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,       -- URL 友好标识
  title TEXT NOT NULL,             -- 菜名
  title_zh TEXT,                   -- 中文菜名（可空）
  description TEXT,                -- 简介
  cook_type TEXT[],                -- 烹饪方式（one-pot/stir-fry/air-fry/steam/...）
  equipment TEXT[],                -- 所需器具
  cookware_count INTEGER DEFAULT 1,-- 锅具数量
  time_prep_min INTEGER,           -- 准备时间（分钟）
  time_cook_min INTEGER,           -- 烹饪时间（分钟）
  time_total_min INTEGER,          -- 总时间（分钟）
  servings INTEGER DEFAULT 2,      -- 默认份数
  difficulty TEXT DEFAULT 'easy',  -- 难度（easy/medium/hard）
  oil_level INTEGER DEFAULT 1,     -- 油量等级 (0-3)
  spice_level INTEGER DEFAULT 0,   -- 辣度等级 (0-3)
  kid_friendly BOOLEAN DEFAULT FALSE,
  tags TEXT[],                     -- 标签（quick/healthy/budget/...）
  cuisine TEXT,                    -- 菜系
  hero_image_url TEXT,             -- 主图 URL
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_recipe_slug ON recipe(slug);
CREATE INDEX IF NOT EXISTS idx_recipe_status ON recipe(status);
CREATE INDEX IF NOT EXISTS idx_recipe_cook_type ON recipe USING GIN(cook_type);
CREATE INDEX IF NOT EXISTS idx_recipe_tags ON recipe USING GIN(tags);

-- 菜谱步骤表
CREATE TABLE IF NOT EXISTS recipe_step (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,     -- 步骤顺序
  instruction TEXT NOT NULL,       -- 步骤说明
  instruction_zh TEXT,             -- 中文说明（可空）
  duration_sec INTEGER,            -- 预计耗时（秒）
  timer_sec INTEGER,               -- 计时器时长（秒，可空）
  method TEXT,                     -- 动作类型（chop/stir/boil/...）
  equipment TEXT,                  -- 所用器具
  concurrent_group TEXT,           -- 并行组标识（同组可并行）
  cleanup_hint TEXT,               -- 清理提示
  temperature_f INTEGER,           -- 温度（华氏度）
  doneness_cue TEXT,               -- 完成指标
  icon_keys TEXT[],                -- 图标键
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_recipe_step_recipe ON recipe_step(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_step_order ON recipe_step(recipe_id, step_order);

-- 菜谱配料表
CREATE TABLE IF NOT EXISTS recipe_ingredient (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- 配料名
  name_zh TEXT,                    -- 中文名（可空）
  qty NUMERIC,                     -- 数量
  unit TEXT,                       -- 单位
  is_optional BOOLEAN DEFAULT FALSE,
  substitutes TEXT[],              -- 可替代项
  category TEXT,                   -- 分类（protein/vegetable/seasoning/...）
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_recipe_ingredient_recipe ON recipe_ingredient(recipe_id);

-- 菜谱媒体表
CREATE TABLE IF NOT EXISTS recipe_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  step_id UUID REFERENCES recipe_step(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'icon')),
  url TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_recipe_media_recipe ON recipe_media(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_media_step ON recipe_media(step_id);

-- 营养快照表
CREATE TABLE IF NOT EXISTS nutrition_snapshot (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID UNIQUE NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  calories_kcal INTEGER,           -- 热量
  protein_g NUMERIC,               -- 蛋白质（克）
  fat_g NUMERIC,                   -- 脂肪（克）
  carbs_g NUMERIC,                 -- 碳水（克）
  fiber_g NUMERIC,                 -- 纤维（克）
  sodium_mg NUMERIC,               -- 钠（毫克）
  retention_applied BOOLEAN DEFAULT FALSE,  -- 是否应用了烹饪损失系数
  confidence_pct INTEGER DEFAULT 80,        -- 置信度百分比
  source TEXT,                     -- 数据来源（usda/manual/estimated）
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 菜谱来源表
CREATE TABLE IF NOT EXISTS recipe_source (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID UNIQUE NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,       -- 来源类型（original/adapted/scraped）
  source_url TEXT,                 -- 原始 URL
  source_name TEXT,                -- 来源名称
  author TEXT,                     -- 作者
  license TEXT,                    -- 许可证
  scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 用户与菜谱交互信号表
CREATE TABLE IF NOT EXISTS recipe_signal (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id UUID NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'view', 'click', 'select', 'cook_start', 'cook_complete',
    'repeat', 'save', 'share', 'emoji_good', 'emoji_neutral', 'emoji_bad',
    'kid_dislike'
  )),
  context JSONB DEFAULT '{}',      -- 上下文信息
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_recipe_signal_recipe ON recipe_signal(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_signal_user ON recipe_signal(user_id);
CREATE INDEX IF NOT EXISTS idx_recipe_signal_type ON recipe_signal(signal_type);

-- ==========================================================================
-- 4. 替代库
-- ==========================================================================

CREATE TABLE IF NOT EXISTS substitutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_ingredient TEXT NOT NULL,
  substitute_ingredient TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('allowable', 'risky', 'baking_sensitive')),
  ratio NUMERIC DEFAULT 1.0,       -- 替换比例
  delta_timeline_sec INTEGER DEFAULT 0,  -- 时间调整（秒）
  delta_nutrition JSONB DEFAULT '{}',    -- 营养变化
  notes TEXT,
  contexts TEXT[],                 -- 适用场景
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (original_ingredient, substitute_ingredient)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_subs_original ON substitutions(original_ingredient);

-- ==========================================================================
-- 5. 建议日志 & 系统表
-- ==========================================================================

-- 晚餐建议日志表
CREATE TABLE IF NOT EXISTS dinner_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  input_text TEXT,                 -- 用户原始输入
  dsl JSONB,                       -- 解析后的 Dinner-DSL
  candidates JSONB,                -- 候选菜谱列表 [{recipe_id, score, rank_reasons}]
  selected_recipe_id UUID REFERENCES recipe(id),
  leftovers_used JSONB,            -- 使用的剩菜信息
  substitutions_applied JSONB,     -- 应用的替代
  decision_time_ms INTEGER,        -- 决策耗时（毫秒）
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_suggestions_user ON dinner_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_household ON dinner_suggestions(household_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_created ON dinner_suggestions(created_at);

-- Feature Flags 表
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN DEFAULT FALSE,
  rollout_pct INTEGER DEFAULT 0,   -- 灰度百分比
  note TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES users(id),
  entity TEXT NOT NULL,            -- 实体类型（recipe/pantry_item/...）
  entity_id UUID,                  -- 实体 ID
  action TEXT NOT NULL,            -- 操作（create/update/delete）
  before_value JSONB,              -- 变更前值
  after_value JSONB,               -- 变更后值
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- 管理员备注表
CREATE TABLE IF NOT EXISTS admin_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_type TEXT NOT NULL,       -- 目标类型（user/recipe/...）
  target_id UUID NOT NULL,         -- 目标 ID
  content TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_admin_notes_target ON admin_notes(target_type, target_id);

-- ==========================================================================
-- 6. 补偿日志表（支持回滚/重放）
-- ==========================================================================

CREATE TABLE IF NOT EXISTS compensation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ts TIMESTAMPTZ DEFAULT now(),
  user_id UUID REFERENCES users(id),
  household_id UUID REFERENCES households(id),
  tool TEXT NOT NULL,              -- 工具名（pantry.consume/leftover.create/...）
  operation TEXT NOT NULL,         -- 操作类型（INSERT/UPDATE/DELETE）
  entity_type TEXT NOT NULL,       -- 实体类型
  entity_id UUID,                  -- 实体 ID
  before_snapshot JSONB,           -- 变更前快照
  after_snapshot JSONB,            -- 变更后快照
  idempotency_key TEXT,            -- 幂等键
  is_rolled_back BOOLEAN DEFAULT FALSE,
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by UUID REFERENCES users(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_compensation_user ON compensation_log(user_id);
CREATE INDEX IF NOT EXISTS idx_compensation_household ON compensation_log(household_id);
CREATE INDEX IF NOT EXISTS idx_compensation_ts ON compensation_log(ts);
CREATE INDEX IF NOT EXISTS idx_compensation_idempotency ON compensation_log(idempotency_key);

-- ==========================================================================
-- 7. RLS 策略
-- ==========================================================================

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE leftovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredient ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dinner_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE compensation_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 辅助函数：判断是否为管理员角色
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT role IN ('admin', 'operator', 'support')
    FROM users
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 辅助函数：获取用户所属家庭 ID 列表
CREATE OR REPLACE FUNCTION get_user_household_ids()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
    SELECT household_id FROM household_members WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- users 表策略
-- ---------------------------------------------------------------------------
CREATE POLICY "用户可查看自己的信息" ON users
  FOR SELECT USING (id = auth.uid() OR is_admin());

CREATE POLICY "用户可更新自己的信息" ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "管理员可查看所有用户" ON users
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- households 表策略
-- ---------------------------------------------------------------------------
CREATE POLICY "用户可查看所属家庭" ON households
  FOR SELECT USING (id IN (SELECT get_user_household_ids()) OR is_admin());

CREATE POLICY "用户可更新所属家庭（仅 owner）" ON households
  FOR UPDATE USING (
    id IN (SELECT household_id FROM household_members WHERE user_id = auth.uid() AND role = 'owner')
  );

CREATE POLICY "管理员可管理所有家庭" ON households
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- household_members 表策略
-- ---------------------------------------------------------------------------
CREATE POLICY "用户可查看同家庭成员" ON household_members
  FOR SELECT USING (household_id IN (SELECT get_user_household_ids()) OR is_admin());

CREATE POLICY "管理员可管理成员关系" ON household_members
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- pantry_items 表策略（按家庭隔离）
-- ---------------------------------------------------------------------------
CREATE POLICY "用户可查看家庭库存" ON pantry_items
  FOR SELECT USING (household_id IN (SELECT get_user_household_ids()) OR is_admin());

CREATE POLICY "用户可管理家庭库存" ON pantry_items
  FOR ALL USING (household_id IN (SELECT get_user_household_ids()));

CREATE POLICY "管理员可管理所有库存" ON pantry_items
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- leftovers 表策略（按家庭隔离）
-- ---------------------------------------------------------------------------
CREATE POLICY "用户可查看家庭剩菜" ON leftovers
  FOR SELECT USING (household_id IN (SELECT get_user_household_ids()) OR is_admin());

CREATE POLICY "用户可管理家庭剩菜" ON leftovers
  FOR ALL USING (household_id IN (SELECT get_user_household_ids()));

CREATE POLICY "管理员可管理所有剩菜" ON leftovers
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- recipe 表策略（公开读取，管理员写入）
-- ---------------------------------------------------------------------------
CREATE POLICY "已发布菜谱公开可读" ON recipe
  FOR SELECT USING (status = 'published' OR is_admin());

CREATE POLICY "管理员可管理菜谱" ON recipe
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- recipe_step / recipe_ingredient / recipe_media / nutrition_snapshot / recipe_source 表策略
-- ---------------------------------------------------------------------------
CREATE POLICY "菜谱步骤公开可读" ON recipe_step
  FOR SELECT USING (
    recipe_id IN (SELECT id FROM recipe WHERE status = 'published') OR is_admin()
  );

CREATE POLICY "管理员可管理菜谱步骤" ON recipe_step
  FOR ALL USING (is_admin());

CREATE POLICY "菜谱配料公开可读" ON recipe_ingredient
  FOR SELECT USING (
    recipe_id IN (SELECT id FROM recipe WHERE status = 'published') OR is_admin()
  );

CREATE POLICY "管理员可管理菜谱配料" ON recipe_ingredient
  FOR ALL USING (is_admin());

CREATE POLICY "菜谱媒体公开可读" ON recipe_media
  FOR SELECT USING (
    recipe_id IN (SELECT id FROM recipe WHERE status = 'published') OR is_admin()
  );

CREATE POLICY "管理员可管理菜谱媒体" ON recipe_media
  FOR ALL USING (is_admin());

CREATE POLICY "营养信息公开可读" ON nutrition_snapshot
  FOR SELECT USING (
    recipe_id IN (SELECT id FROM recipe WHERE status = 'published') OR is_admin()
  );

CREATE POLICY "管理员可管理营养信息" ON nutrition_snapshot
  FOR ALL USING (is_admin());

CREATE POLICY "菜谱来源公开可读" ON recipe_source
  FOR SELECT USING (
    recipe_id IN (SELECT id FROM recipe WHERE status = 'published') OR is_admin()
  );

CREATE POLICY "管理员可管理菜谱来源" ON recipe_source
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- recipe_signal 表策略
-- ---------------------------------------------------------------------------
CREATE POLICY "用户可查看自己的信号" ON recipe_signal
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "用户可创建自己的信号" ON recipe_signal
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "管理员可管理所有信号" ON recipe_signal
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- substitutions 表策略（公开读取）
-- ---------------------------------------------------------------------------
CREATE POLICY "替代库公开可读" ON substitutions
  FOR SELECT USING (TRUE);

CREATE POLICY "管理员可管理替代库" ON substitutions
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- dinner_suggestions 表策略
-- ---------------------------------------------------------------------------
CREATE POLICY "用户可查看自己的建议" ON dinner_suggestions
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "用户可创建建议记录" ON dinner_suggestions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "管理员可管理所有建议" ON dinner_suggestions
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- feature_flags 表策略（只读）
-- ---------------------------------------------------------------------------
CREATE POLICY "所有用户可读取 flags" ON feature_flags
  FOR SELECT USING (TRUE);

CREATE POLICY "管理员可管理 flags" ON feature_flags
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- audit_logs 表策略（仅管理员可读）
-- ---------------------------------------------------------------------------
CREATE POLICY "管理员可查看审计日志" ON audit_logs
  FOR SELECT USING (is_admin());

CREATE POLICY "系统可写入审计日志" ON audit_logs
  FOR INSERT WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- admin_notes 表策略
-- ---------------------------------------------------------------------------
CREATE POLICY "管理员可管理备注" ON admin_notes
  FOR ALL USING (is_admin());

-- ---------------------------------------------------------------------------
-- compensation_log 表策略
-- ---------------------------------------------------------------------------
CREATE POLICY "用户可查看自己家庭的补偿日志" ON compensation_log
  FOR SELECT USING (
    household_id IN (SELECT get_user_household_ids())
    OR user_id = auth.uid()
    OR is_admin()
  );

CREATE POLICY "系统可写入补偿日志" ON compensation_log
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "管理员可管理补偿日志" ON compensation_log
  FOR ALL USING (is_admin());

-- ==========================================================================
-- 8. 触发器：自动更新 updated_at
-- ==========================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_households_updated_at
  BEFORE UPDATE ON households
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_pantry_items_updated_at
  BEFORE UPDATE ON pantry_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_recipe_updated_at
  BEFORE UPDATE ON recipe
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_nutrition_snapshot_updated_at
  BEFORE UPDATE ON nutrition_snapshot
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_substitutions_updated_at
  BEFORE UPDATE ON substitutions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================================================
-- End of Schema
-- ==========================================================================
