/**
 * Admin 角色验证中间件
 *
 * 校验请求用户是否具有 admin/operator/support 角色
 * 从 Supabase JWT 中提取用户信息
 */

// 允许的管理员角色
const ADMIN_ROLES = ['admin', 'operator', 'support'];

/**
 * Admin 角色验证中间件
 * 校验 JWT 并检查用户角色
 */
export async function adminAuthMiddleware(req, res, next) {
  try {
    const supabase = req.supabase;
    
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        message: 'Supabase client not available',
        trace_id: req.traceId
      });
    }

    // 获取 Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        message: '未授权：缺少有效的访问令牌',
        trace_id: req.traceId
      });
    }

    const token = authHeader.substring(7);

    // 验证 JWT 并获取用户信息
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        ok: false,
        message: '未授权：无效的访问令牌',
        trace_id: req.traceId
      });
    }

    // 从 user metadata 或数据库获取角色
    let userRole = user.user_metadata?.role || user.app_metadata?.role;

    // 如果 metadata 中没有角色，从数据库查询
    if (!userRole) {
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      userRole = userData?.role || 'user';
    }

    // 检查是否有管理员权限
    if (!ADMIN_ROLES.includes(userRole)) {
      return res.status(403).json({
        ok: false,
        message: '禁止访问：您没有管理员权限',
        required_roles: ADMIN_ROLES,
        your_role: userRole,
        trace_id: req.traceId
      });
    }

    // 将用户信息附加到请求对象
    req.adminUser = {
      id: user.id,
      email: user.email,
      role: userRole
    };

    next();
  } catch (error) {
    console.error('[adminAuth] Error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message || 'Internal server error',
      trace_id: req.traceId
    });
  }
}

/**
 * 角色权限检查辅助函数
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.adminUser) {
      return res.status(401).json({
        ok: false,
        message: '未授权',
        trace_id: req.traceId
      });
    }

    if (!roles.includes(req.adminUser.role)) {
      return res.status(403).json({
        ok: false,
        message: '禁止访问：您没有执行此操作的权限',
        required_roles: roles,
        your_role: req.adminUser.role,
        trace_id: req.traceId
      });
    }

    next();
  };
}

export default adminAuthMiddleware;

