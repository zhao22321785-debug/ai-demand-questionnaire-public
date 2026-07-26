# OpenAI 分析接入说明

## 当前实现边界

分析请求由 Netlify Functions 在服务端发出，使用原生 HTTP 调用 OpenAI **Responses API** 的 `/v1/responses`。前端构建只允许读取 `VITE_*` 公共变量；`OPENAI_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 与 `ANALYSIS_INTERNAL_SECRET` 只能配置在服务端环境，绝不能写入浏览器代码、`dist`、Git 或日志。

每次请求均包含：

- `store: false`，避免由 API 保存请求内容；
- `text.format` 的严格 JSON Schema；
- 服务端的 Zod 校验，拒绝不符合输出协议的结果；
- `ANALYSIS_MODEL_TIMEOUT_MS` 硬超时、`ANALYSIS_MAX_RESPONSE_BYTES` 响应体上限和 `ANALYSIS_MAX_OUTPUT_TOKENS` 输出上限；
- `redirect: manual`，拒绝携带 Bearer key 自动跳转到其他 origin；
- 从 `OPENAI_MODEL` 读取的模型名，不在代码中固定模型。

结果是对现有答卷的初步分析，供管理员继续了解线索；它不代表立项、优先级或技术可行性结论。

## 配置与网关边界

生产或预览环境应在托管平台的服务端环境中配置 `OPENAI_API_KEY`、`OPENAI_MODEL`。不配置 `OPENAI_BASE_URL` 时只使用官方 `https://api.openai.com/v1`；兼容网关必须使用 HTTPS，并把 hostname 显式加入 `OPENAI_ALLOWED_HOSTS`。服务会拒绝 credentials、localhost、IP 目标和自动重定向。网关必须保持 Bearer 鉴权、结构化输出、错误状态码与 `Retry-After` 的语义；不兼容时应使用 mock，而不是在前端降级或绕过鉴权。

`ANALYSIS_MAX_RETRY_DELAY_MS` 限制 `Retry-After`，失败后只记录 `next_retry_at` 并退出当前函数，由计划任务恢复；不会在一次 invocation 内长时间等待。`ANALYSIS_USER_DAILY_LIMIT`、`ANALYSIS_ADMIN_RETRY_COOLDOWN_SECONDS`、`ANALYSIS_ADMIN_DAILY_RETRY_LIMIT`、`ANALYSIS_RECONCILE_BUDGET_MS` 与 `ANALYSIS_RECONCILE_JOB_LIMIT` 分别限制普通分析请求、单 job 管理员重试、同一管理员跨 job 的每日重试总量和单次补偿任务成本。内部回调必须配置固定的 `ANALYSIS_CALLBACK_ORIGIN`；生产只接受 HTTPS，本地明确使用 `localhost` 时才允许 HTTP。

`OPENAI_MODEL` 是切换模型的唯一运行时入口。切换前应在隔离环境用非敏感 fixture 验证 JSON Schema、拒答、超时与限流处理；**任何平台变量写入、网关切换或重新部署都需要明确授权**。

## 本地无 Key 验证

本地默认 `VITE_DATA_MODE=mock`，不需要 OpenAI Key、Supabase 或 Docker。mock 产出确定性结果，用于页面、状态、失败提示和 E2E 验收，不能证明真实模型质量、网关兼容性或生产权限。

Netlify Deploy Preview 在没有真实模型 Key 时，可以显式设置 `ANALYSIS_MODEL_MODE=mock`，复用同一确定性模型完成远程数据库、Functions 和页面联调。该模式在 production context 会直接拒绝启动；Production 必须使用默认的 `openai` 模式并配置服务端模型变量。

运行：

```powershell
npm run typecheck
npm test
npm run build
npm run check:secrets
npm run check:analysis
```

## 环境变量命名

当前前端读取 `VITE_SUPABASE_PUBLISHABLE_KEY`。若旧文档或旧项目写作 `VITE_SUPABASE_ANON_KEY`，迁移时应将该旧变量的值映射为 `VITE_SUPABASE_PUBLISHABLE_KEY`，并同步更新部署平台变量；不要同时改为代码未读取的变量名。它是浏览器可见的 publishable key，不能替代服务端 `SUPABASE_SERVICE_ROLE_KEY`。
