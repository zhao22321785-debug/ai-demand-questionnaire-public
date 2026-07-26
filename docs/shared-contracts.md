# M1 共享接口

## 文件所有权

- 主 Agent：`src/app`、`src/lib`、`src/types`、`src/components`、认证、迁移文件与最终集成。
- 员工模块：`src/features/employee-survey` 及 `src/features/responses/EmployeeReviewPage.tsx`。
- 岗位模块：`src/features/position-survey` 及 `src/features/responses/PositionReviewPage.tsx`。
- 管理端：`src/features/admin`。

各模块不得修改或回滚其他模块的文件。路由统一由主 Agent 在集成阶段更新。

## 稳定接口

- 领域类型：`src/types/survey.ts`
- 数据访问契约：`src/lib/data/contracts.ts`
- 模拟数据实现：`src/lib/data/mock-data-client.ts`
- React 注入入口：`DataClientProvider`、`useDataClient()`
- 页面公共布局：`AuthLayout`、`SurveyLayout`、`AdminFrame`、`StepLayout`
- 通用状态：`PageState`

模块使用 `useDataClient()` 读取参考数据、保存问卷和查询答卷，不直接访问 localStorage，也不在模块内创建 Supabase 客户端。

## M1 状态口径

保存成功后答卷立即有效，分析状态暂为 `pending`。M1 不调用模型；复盘和管理员详情必须继续展示原始答卷和“分析准备中”状态。
