# Security Policy / 安全策略

## Supported Versions / 维护范围
We actively maintain the latest `main` branch and the most recent tagged release.
我们只对 `main` 分支与最近的稳定版本提供安全修复。

## Reporting a Vulnerability / 报告安全问题
**Please do NOT open a public issue.**  
请勿在公开的 Issue 中披露漏洞。

Email / 邮箱：**security@useweeknight.com**  
(If you need encryption, request our PGP public key in the email.)
（如需加密，请在邮件中索取我们的 PGP 公钥。）

Please include / 请尽量提供：
- Affected repo & commit/tag（受影响的仓库与版本）
- Impact & reproduction steps（影响评估与复现步骤）
- PoC (if available)（可选 PoC）

**Response targets / 响应承诺**
- Acknowledge within **48h**（48 小时内确认收到）
- Triage and provide ETA within **7 days** for High/Critical issues  
  （高危/严重问题 7 天内给出修复或缓解 ETA）

## Scope / 范围
- This repository: `mcp-server` (runtime, Docker image if applicable)
- Dependencies are managed via Dependabot (please include CVE if known)
- Cloud configs & secrets are out of scope for this repo; report privately to the same email.
- 本仓库代码与构建产物；依赖由 Dependabot 管理（若有 CVE 请附上）。
- 云端配置与密钥不在本仓范围内，但仍可通过上述邮箱私下报告。

## Disclosure / 披露
We follow responsible disclosure: we’ll coordinate fixes and credit reporters upon request.
我们遵循“负责任披露”，在修复后与您协同披露；如您希望署名，将在公告中致谢。

