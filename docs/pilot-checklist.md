# M1–M4 本地试点验收清单

> 本清单只验证本地 mock 和构建产物；不代表真实 Supabase、真实模型或线上部署已经验证。

## M1 问卷与权限

- [ ] 员工入口显示登录/注册，不展示管理员登录入口。
- [ ] 管理员入口不提供注册，未登录访问受保护页面会回到对应入口。
- [ ] 普通会话访问 `/admin` 会回到员工身份页；管理员会话能看到只读总览。
- [ ] 员工与岗位问卷可保存、复盘、修改，版本号与原始答卷可见。

## M2 单份分析与恢复

- [ ] mock 下的分析状态、原始答卷和初步分析文案可见，且不暗示立项或优先级。
- [ ] 加载状态、空状态、失败状态与重新尝试入口可见；失败后原始答卷仍可查看。
- [ ] 修改答卷后旧分析不会被当作当前版本结果；出现 stale 时应要求重新分析。
- [ ] stalled 任务重新领取后旧 lease 无法记录 attempt、complete 或 failed；`next_retry_at` 到期前不会重新领取。
- [ ] 保存成功后即使不调用 `/api/analyze`，当前 revision 仍有唯一 queued durable job；reconciler 能在预算/条数上限内补建历史孤儿。
- [ ] 用户达到日限额后，直接 dispatch 与 reconciler claim 都不能启动新 job；job 保持 queued 到下一数据库日，同一 job 自动重试不重复计费。

## M3 聚合与样本保护

- [ ] 管理端能区分原始答卷、需求场景和双方差异；未提及不会被显示为冲突。
- [ ] 样本少于 `MIN_AGGREGATE_SAMPLE_SIZE` 时不展示聚合结论，显示样本保护提示。
- [ ] pending/failed/complete 混合时，提示中的“可用来源”只统计 complete 且可聚合的当前分析；“有效答卷”仍显示全部原始答卷。
- [ ] 空数据、筛选后无数据、读取失败与加载中均有用户可见的说明。
- [ ] 聚合运行只在 `running` 且来源快照未变化时原子完成；来源变更或并发 stale 后旧 worker 不能写回 complete/failed。

## M4 发布、安全与恢复

- [ ] `npm run build` 成功，并运行 `npm run check:secrets`；构建产物无服务端变量名或疑似真实密钥。
- [ ] Production 缺少/误设模式、URL 项目不匹配或 publishable key 为空时 `npm run check:deploy` 非零退出；正确公开配置通过，日志不包含 key 值。Deploy Preview 未显式选 mock/supabase 时同样失败。
- [ ] `npm run check:analysis` 通过：Responses API 使用 `store:false`、模型从环境读取且没有固定模型名。
- [ ] `npm run test:e2e` 在本地 mock 通过，覆盖未登录守卫、员工/管理员隔离和管理员只读总览。
- [ ] `.env.example` 无真实密钥；前端使用 `VITE_SUPABASE_PUBLISHABLE_KEY`，旧 `VITE_SUPABASE_ANON_KEY` 已按运维说明映射。
- [ ] 模型 timeout、响应体、输出 token、Retry-After、用户日限额、管理员单 job 冷却、管理员跨 job 日限额、reconcile 总预算/条数均按安全值配置；兼容网关 host 已显式 allowlist，callback 使用固定 HTTPS origin。
- [ ] 管理员跨不同 job 达到日限额后返回 429 + `Retry-After`；重试前后原 job 的 `requested_by` 不变，事件账本记录 admin actor/job/时间窗。
- [ ] 已演练只读恢复检查：从上一份构建启动后，登录页、权限隔离、空数据提示和原始答卷入口均可见。

## 远程 Auth 授权门（开放注册）

- [ ] 已取得目标 Supabase 项目的远程配置授权；项目标识、操作者、时间和变更单已留证，未在文档中记录密钥。
- [ ] 邮箱确认已开启并实测：未确认邮箱不能取得可用会话，确认链接的过期与重复使用行为符合策略。
- [ ] 允许域或邀请策略已由服务端/Auth Hook 执行并实测拒绝路径，不依赖前端隐藏入口。
- [ ] 注册、登录、重发确认邮件和找回密码已配置限流；公开入口已启用验证码或等效反自动化措施。
- [ ] 已配置异常注册监控与处置：注册突增、高频失败、非允许域、邮件异常和新账号异常提交均有告警负责人及暂停入口步骤。
- [ ] 新注册、未确认、已确认、disabled、管理员和 service role 的权限 smoke test 已留存结果；未通过时真实批次保持 draft。

## 远程迁移静默与完整性门

- [ ] 已取得部署与远程迁移授权并判定基线：空库先离线应用 1–9（到 1500），再部署兼容 Functions 做旧签名 smoke；已有 1500 环境直接先部署兼容 Functions。旧签名未通过时不应用 1600。
- [ ] 目标 batch 保持 `draft`；保存/analyze/retry/background/reconciler 全部停止且在途请求已排空。迁移前已只读检查 active batch 与 orphan 候选数量；重复/超阈值时已停止并人工裁决，没有静默选择或无界 backfill。
- [ ] 依次应用 1600、1700，未重放 1–9；PostgREST schema cache 已识别新旧兼容签名，且员工维度校验函数只向 `service_role` 开放执行。
- [ ] PostgREST schema cache 已识别新旧兼容签名；NULL/0/101 配额参数负向 smoke test 均 fail-closed，job/result/ledger 无变化。
- [ ] 迁移后已只读核对所有当前 subject + revision：parent revision 存在，员工 task children、岗位 work-item/task children 数量与标识完整对应。
- [ ] 迁移后已核对当前 pending/stale revision 的唯一 durable job、requested_by、状态分布与孤儿数；没有把 job 存在等同于已获得 claim 配额。
- [ ] 已用 pending/failed/complete 混合数据核对：有效答卷总数、complete 可用来源数、聚合 sampleSize 和样本提示口径一致。
- [ ] 如发现 revision、children、job 或来源口径缺失/重复，已保持入口关闭和 batch draft，完成受控修复并再次核对；未以“迁移成功”替代数据完整性检查。
- [ ] 迁移、完整性/口径核对与权限 smoke test 全部留证通过后，才通过 service-only 原子 RPC 激活批次并恢复入口；本地勾选不代表远程步骤已执行。
- [ ] 回滚演练已确认：默认 forward-fix；旧构建只允许短时降级回退且旧 claim 每 actor/日上限为 1；数据库回退必须恢复完整迁移前快照，不把 app-only rollback 当作 schema rollback。

## 人工签核

记录人：`<OPERATOR>`<br>
环境：`<LOCAL_OR_PREVIEW_ENVIRONMENT>`<br>
时间：`<YYYY-MM-DD>`
结论：`<PASS_OR_BLOCKED>`

涉及远程变量、数据、备份恢复或部署时，请先取得明确授权并在变更单中记录；本清单不授予这些操作权限。
