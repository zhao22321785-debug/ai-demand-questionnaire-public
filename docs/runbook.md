# M4 本地上线与运维手册

## 范围与上线门槛

本项目默认以 `VITE_DATA_MODE=mock` 本地运行。此模式不连接真实 Supabase、不调用真实模型，也不应包含任何密钥。上线前先在本地运行 `npm run verify` 与 `npm run test:e2e`；构建产物必须通过 `npm run check:secrets`。

`npm run build` 会先执行无密钥配置检查。`CONTEXT=production` 只接受固定的 `VITE_DATA_MODE=supabase`、项目 `exampleprojectref123` 的 HTTPS URL 和非空 publishable key；`CONTEXT=deploy-preview` 必须显式选择 `mock` 或 `supabase`。缺失或项目不匹配时构建直接失败，检查日志只记录变量名，不记录 key 值。无 `CONTEXT` 的本地 mock 构建保持可用。没有安装或调用 Netlify CLI，也没有配置部署凭证。

## 环境变量与权限

- 浏览器：`VITE_DATA_MODE`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。
- 服务端：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_ALLOWED_HOSTS`、`OPENAI_MODEL`、`ANALYSIS_INTERNAL_SECRET`、`ANALYSIS_CALLBACK_ORIGIN`、`ANALYSIS_MODEL_TIMEOUT_MS`、`ANALYSIS_MAX_RESPONSE_BYTES`、`ANALYSIS_MAX_OUTPUT_TOKENS`、`ANALYSIS_MAX_RETRY_DELAY_MS`、`ANALYSIS_USER_DAILY_LIMIT`、`ANALYSIS_ADMIN_RETRY_COOLDOWN_SECONDS`、`ANALYSIS_ADMIN_DAILY_RETRY_LIMIT`、`ANALYSIS_RECONCILE_BUDGET_MS`、`ANALYSIS_RECONCILE_JOB_LIMIT`、`MIN_AGGREGATE_SAMPLE_SIZE`。这些值必须在 Netlify 环境变量中包含 **Functions scope**；写在 `netlify.toml` 的环境变量只供构建使用，不会自动进入 Functions runtime。
- `.env.example` 只提供变量名与安全默认值；真实值仅能存放在本机未提交的 `.env.local` 或托管平台服务端变量中。
- Production 的 `VITE_DATA_MODE=supabase` 固定在 `netlify.toml`；Production URL/key 和 Deploy Preview 的显式模式仍需在托管环境按作用域配置，并用 `npm run check:deploy` 留证。不得把 publishable key 的值复制到检查输出或变更记录。
- Node Functions 从 `process.env` 读取服务端配置，并以调用上下文的 `context.deploy.context` 判断 Production；不得使用 Edge Functions 专属的 `Netlify.env`，也不得以构建期 `CONTEXT` 代替运行时部署上下文。

旧配置中的 `VITE_SUPABASE_ANON_KEY` 需映射到当前读取的 `VITE_SUPABASE_PUBLISHABLE_KEY`，不能让前端改读旧变量。

## 开放注册 Auth 上线门（远程）

邮箱密码自注册是 M1 已确认能力，不能通过把新用户默认设为 disabled 来替代准入控制。启用真实 Supabase 前，身份管理员必须在目标项目逐项确认并留证：

1. 开启邮箱确认，验证未确认邮箱不能取得可用会话；同时验证确认链接过期、重复点击和改密后的行为。
2. 明确并实施允许域或邀请策略。允许域应使用服务端/Auth Hook 校验规范化后的邮箱域；邀请制应验证邀请一次性、有效期和撤销。不能只靠前端隐藏注册入口。
3. 为注册、登录、重发确认邮件和找回密码配置限流；公开入口启用验证码或等效反自动化措施，并验证失败时不会创建可用账号。
4. 监控注册量突增、同源高频失败、非允许域尝试、确认邮件异常和新账号问卷提交异常；告警必须包含处置人、观察窗口和暂停注册/批次入口的操作步骤，但不得记录密码、令牌或完整答卷。
5. 用新注册、未确认、已确认、disabled 和管理员账号分别执行权限 smoke test，确认普通用户只能读取自己的业务数据，管理员仅获得产品定义的只读管理能力。

以上均为远程 Auth 或项目配置变更，执行前必须获得明确授权。未取得授权或任一项未留证时，保持真实批次为 draft，不开放试点入口。

## 管理员、批次与字典

1. 由具备身份管理权限的操作员创建管理员账号，并在 `user_roles` 中设置 `role=admin`、`status=active`。
2. 停用时将其角色记录改为 `status=disabled`，保留审计记录；不要删除历史答卷或角色记录。
3. 密码重置通过身份提供方的受控重置流程进行，不收集、显示或写入用户密码。
4. 新批次应先创建并校验员工、岗位问卷版本。迁移会在重复 active 时明确失败，并以唯一索引强制最多一个 active；不得人工静默选择保留项。
5. 获得授权后，仅由 service role/数据库 owner 运行 `supabase/manual/activate_m1_development_batch.sql` 所示 RPC。该 RPC 在锁内校验目标为 draft、两份版本 active、时间窗口未结束，关闭旧 active 后再激活目标；本轮未执行。
6. 部门、岗位、AI 工具字典应以新增、停用、排序为主，避免直接删除被答卷引用的条目。

上述动作会写入远程身份或数据库：**必须获得明确授权**，并将实际项目、批次 ID、操作者和时间填入受控变更记录（例如 `<PROJECT_REF>`、`<BATCH_ID>`），不得在此文档填真实凭证。

## 分析运行、重试与 stale

- 两类答卷保存事务会为新 `(subject_type, subject_id, revision)` 同时写入唯一 queued job；浏览器 `/api/analyze` 仅做配额预检和低延迟 dispatch。关闭页面或 dispatch 失败不会删除 durable job，reconciler 每轮在总预算和条数上限内补建历史孤儿并继续处理。
- 用户日限额最终在 claim/admission 边界执行：私有只追加 actor/job 账本以 actor + 数据库日期加锁；同一 job 的自动重试不重复消费。超限 job 保持 queued，`next_retry_at` 推迟到下一数据库日；不得通过取消浏览器请求、跳过 `/api/analyze` 或等待 reconciler 绕过。
- 管理员仅在确认原始答卷、版本和失败代码后触发重试；保留 `attempt_count`、错误摘要、模型名、提示词版本和时间戳。
- 管理员重试同时受单 job 冷却和 actor 每日跨 job 总量限制；429 必须遵循响应中的 `Retry-After`，不得换 job 绕过。重试事件进入独立只追加账本，原 job 的 `requested_by` 保持初始请求人不变。
- 版本已变化、锁超时或结果不再对应当前答卷时标记 `stale`，不展示为当前结论；先重新读取当前版本，再从受控入口重新分析。
- 聚合分析必须受 `MIN_AGGREGATE_SAMPLE_SIZE`（默认 3）保护。样本不足只显示保护提示，不生成聚合结论。

模型变量切换（`OPENAI_MODEL` / `OPENAI_BASE_URL`）前，先在隔离环境用 mock 或非敏感 fixture 校验结构化输出；任何服务端变量变更、重试写入或重部署都**需要明确授权**。

## 远程迁移强制静默门

应用远程迁移前必须取得明确授权，并执行以下强制门；本文只定义流程，不代表已经执行：

1. 先判定远程迁移基线。当前专用项目为空时，保持所有入口离线，先按顺序应用 1–9（截至 1500）；确认旧 enqueue/三参数 claim 与 ACL 后，再部署当前兼容版本 Functions 并在旧签名上 smoke test。若目标环境已留证到 1500，则直接先部署兼容 Functions。未经部署/迁移授权不得执行任一路径。
2. 兼容 Functions 对新 preflight/四参数 claim 的 `PGRST202/42883` 只回退旧 enqueue/三参数 claim。旧签名 smoke 通过后，继续保持目标 batch 为 `draft`，停止保存、`/api/analyze`、管理员 retry、background callback 和 scheduled reconciler，排空所有在途保存与 worker。
3. 应用 1600 前只读核对 active batch 数量与 orphan 候选数量；active 超过 1 时停止迁移并由负责人记录处置方案，禁止脚本静默选择。候选量超过批准阈值时不执行无界首次 backfill，改为迁移后调用有界 repair RPC。
4. 入口静默且检查通过后依次应用 1600、1700，不修改或重放 1–9；等待 PostgREST schema cache 识别新 preflight、四参数 claim 和兼容旧签名。1700 仅向 `service_role` 授予员工维度校验函数的 `EXECUTE`，否则员工分析在更新 `analysis_status`、重新检查表约束时会以 `42501` 失败。
5. 执行 service-role RPC 正反向 smoke test；显式 NULL/0/101 必须返回参数错误且不改变 ledger/job/result。另核对 `service_role` 对 `private.is_valid_dimension_answers(jsonb)` 有 `EXECUTE`，`anon`、`authenticated` 均没有，再分别完成一份员工和岗位分析终结。
6. 迁移后以只读查询核对：每个当前 subject + revision 都存在一份 parent revision，且员工 task children、岗位 work-item/task children 的数量和标识完整对应当前记录。
7. 同时核对每个当前 `pending`/`stale` subject + revision 有且仅有一份 durable job、job.requested_by 对应答卷用户；统计 queued/running/complete/failed/stale 与当前 revision 一致，没有孤儿 current revision。
8. 核对看板“有效答卷”仍等于原始答卷总数，“可用来源数”只等于当前 revision 且 complete、可参与聚合的分析数；用 pending/failed/complete 混合样本验证阈值提示。
9. 如果发现 revision、children、job、配额或来源口径缺失/重复，保持 batch 为 `draft`、继续关闭入口；先按受控变更修复并再次完整核对，不得直接开放试点。
10. 只有迁移、上述核对和权限 smoke test 均留证通过后，才能恢复 Functions、保存入口或通过原子 RPC 激活 batch。

## 备份、回滚与试点清理

- 备份应覆盖数据库结构、版本化问卷/字典、角色、批次、当前答卷、append-only revision 历史、分析作业和分析结果；加密保存并定期演练恢复。
- 默认采用 forward-fix。1600 保留旧 enqueue/三参数 claim 兼容 wrapper，1700 补齐员工约束校验所需的最小 worker 权限；上一构建可作为短时应急回退，但旧 claim 固定每 actor/数据库日最多 1 次，属于降级模式。回退时先暂停分析入口并尽快恢复当前构建。若必须回退数据库，只能在所有写入冻结时恢复完整迁移前快照，再核对 revision/job/ledger；不得把 app-only rollback 当作数据库已回退。
- 试点结束后，按已批准的数据保留期导出必要审计材料，再匿名化或删除试点测试账号与数据；删除、导出、恢复、部署和远程数据库操作均**需要明确授权**。

## 非生产预览数据

预览数据脚本只允许访问固定 Supabase 项目 `exampleprojectref123.supabase.co` 与精确 HTTPS Preview alias `public-preview--ai-demand-questionnaire.netlify.app`，不允许 Production alias、loopback、其他项目、URL 凭证或相似域名。执行前必须获得目标环境写入授权，并确认该环境已经应用当前迁移、只有一个处于有效时间窗口内的 active batch，且至少有三条启用的部门、三条启用的岗位和两条启用的 AI 工具记录。脚本使用固定邮箱前缀 `preview-seed-20260724-`，通过服务端 Auth Admin API 创建测试账号，再以每个账号的 authenticated 会话保存资料并调用答卷 RPC；service role 不参与答卷保存，且不得进入浏览器或日志。

生成命令需要在当前 PowerShell 进程提供以下五个变量，不要写入仓库或提交 `.env`：

- `PREVIEW_SEED_SUPABASE_URL`：隔离预览 Supabase URL。
- `PREVIEW_SEED_PUBLISHABLE_KEY`：仅用于测试账号登录的 publishable key。
- `PREVIEW_SEED_SERVICE_KEY`：仅供本机服务端脚本调用 Auth Admin API 和读取分析状态。
- `PREVIEW_SEED_PREVIEW_URL`：必须是上述精确 HTTPS Preview alias。
- `PREVIEW_SEED_INTERNAL_SECRET`：与预览 Functions 的 `ANALYSIS_INTERNAL_SECRET` 一致，仅作为请求头发送。

`npm run seed:preview` 是 first-run-only、create-once 命令，不接受 `--replace` 或其他参数。命令先调用受内部 secret 保护的只读 preflight；只有 runtime deploy context 为 `branch-deploy` 或 `deploy-preview`、Functions 使用批准的 Supabase 项目且模型键为 `deterministic-mock` 时，才会创建 Supabase 客户端。所有内部请求均禁止自动重定向，任何 3xx、非 JSON、`accepted !== true` 或 aggregate `result !== updated` 都会失败。若 Auth 中已存在任何固定前缀账号，命令在远程写入前中止。

脚本为每个账号生成只存在于内存中的随机密码，最多等待当前十个分析作业 180 秒。部分失败时不会自动删除、替换或回滚已创建的 Auth 用户和答卷；流程会停止后续分析或聚合，仅输出失败阶段以及本次已创建的非秘密 user/subject ID，供人工核对。全部 job complete 后还会核对当前 subject/revision 的 complete analysis、`deterministic-mock` 模型键，以及最新 complete aggregate 是否包含全部十个 seeded source。成功输出只包含 created user、员工/岗位答卷、当前 complete analysis、failed/nonterminal job、aggregate 状态和来源总数。

仓库不提供 preview cleanup 命令、cleanup RPC 或迁移。完整清理需要另行批准并设计数据库级清理方案；只删除 Auth 用户不代表派生答卷、分析结果、聚合来源与审计历史已经删除。生成的数据和分析输出属于模拟调研证据，只能用于验证页面、状态流转和聚合流程，不能作为模型质量、真实用户需求或业务结论的证据。

## 日志与禁记字段

日志可记录请求 ID、批次/答卷匿名 ID、状态、错误码、重试次数、模型配置标识和耗时。不得记录密码、访问令牌、`SUPABASE_SERVICE_ROLE_KEY`、`OPENAI_API_KEY`、`ANALYSIS_INTERNAL_SECRET`、Authorization 头、完整答卷原文、姓名/邮箱/部门等直接身份信息，或模型原始输入输出。排障需要原文时须走单独的最小化、限时授权流程。
