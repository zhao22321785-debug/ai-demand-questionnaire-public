import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const failures = [];
const modelClient = read('netlify/functions/_shared/openai-model-client.ts');
const environment = read('netlify/functions/_shared/env.ts');
const runtimeModel = read('netlify/functions/_shared/runtime-model.ts');
const schemas = read('netlify/functions/_shared/analysis-schemas.ts');
const analysisService = read('netlify/functions/_shared/analysis-service.ts');
const callback = read('netlify/functions/_shared/internal-callback.ts');
const analyzeEndpoint = read('netlify/functions/analyze-submission.ts');
const analysisStore = read('netlify/functions/_shared/supabase-analysis-store.ts');
const reconciler = read('netlify/functions/reconcile-analysis-jobs.ts');
const packageJson = read('package.json');
const deployCheck = read('scripts/check-deploy-config.mjs');
const dashboard = read('netlify/functions/admin-dashboard.ts');
const adminDemandPage = read('src/features/admin/demands.tsx');
const mockDashboard = read('src/lib/analysis/dashboard.ts');
const runtimeEnv = read('netlify/functions/_shared/runtime-env.ts');
const previewSeedPreflight = read('netlify/functions/preview-seed-preflight.ts');
const functionRuntimeSources = [
  read('netlify/functions/analyze-submission.ts'),
  read('netlify/functions/analyze-submission-background.ts'),
  read('netlify/functions/retry-analysis.ts'),
  read('netlify/functions/aggregate-analysis-background.ts'),
  read('netlify/functions/admin-dashboard.ts'),
  read('netlify/functions/reconcile-analysis-jobs.ts'),
  previewSeedPreflight,
  read('netlify/functions/_shared/internal-callback.ts'),
].join('\n');
const example = read('.env.example');

if (!/store\s*:\s*false/.test(modelClient)) failures.push('模型请求必须设置 store:false。');
if (!/model\s*:\s*this\.config\.model/.test(modelClient)) failures.push('模型名称必须从运行时配置读取。');
if (/model\s*:\s*['\"](?:gpt|o\d|claude|gemini)[^'\"]*['\"]/i.test(modelClient)) failures.push('模型客户端不能写死模型名称。');
if (!/OPENAI_MODEL:\s*z\.string\(\)\.min\(1/.test(environment)) failures.push('OPENAI_MODEL 必须是必填运行时变量，且不能提供默认模型。');
if (!/redirect:\s*['"]manual['"]/.test(modelClient)) failures.push('模型请求必须禁止自动重定向。');
if (!/new AbortController\(\)/.test(modelClient) || !/requestTimeoutMs/.test(modelClient)) failures.push('模型请求缺少硬超时。');
if (!/max_output_tokens/.test(modelClient)) failures.push('模型请求缺少 max_output_tokens。');
if (!/maxResponseBytes/.test(modelClient) || !/response_too_large/.test(modelClient)) failures.push('模型响应缺少严格字节上限。');
if (!/OPENAI_ALLOWED_HOSTS/.test(environment) || !/api\.openai\.com/.test(environment)) failures.push('模型网关缺少官方默认与显式 host allowlist。');
if (!/ANALYSIS_MODEL_MODE/.test(runtimeModel) || !/production[^\n]+mock|mock[^\n]+production/.test(runtimeModel)) failures.push('Preview mock 模型缺少 production fail-closed 边界。');
if (!/readCallbackOrigin/.test(callback) || /request\.url/.test(analyzeEndpoint)) failures.push('内部回调仍可能从入站 URL 派生。');
if (!/maxLength:\s*4000/.test(schemas) || !/maxItems:\s*20/.test(schemas)) failures.push('Responses JSON Schema 缺少字符串或数组上限。');
if (/setTimeout\s*\(/.test(analysisService)) failures.push('单次分析 invocation 不得长时间 sleep。');
if (!/leaseToken/.test(analysisService)) failures.push('单份分析写入缺少 lease token 传播。');
if (!/slice\(0,\s*ANALYSIS_MAX_EXCERPT_LENGTH\)/.test(analysisService)) failures.push('Canonical evidence excerpt 缺少统一长度上限。');
if (!/SingleAnalysisResultSchema\.parse\(sanitizeSingleAnalysisResult\(/.test(analysisService)) failures.push('Canonical result 在 complete 前缺少后置 Schema parse。');
if (!/MIN_AGGREGATE_SAMPLE_SIZE=3/.test(example)) failures.push('.env.example 必须提供 MIN_AGGREGATE_SAMPLE_SIZE=3 的安全默认值。');
for (const name of ['ANALYSIS_MODEL_MODE', 'ANALYSIS_CALLBACK_ORIGIN', 'OPENAI_ALLOWED_HOSTS', 'ANALYSIS_MODEL_TIMEOUT_MS', 'ANALYSIS_MAX_RESPONSE_BYTES', 'ANALYSIS_MAX_OUTPUT_TOKENS', 'ANALYSIS_MAX_RETRY_DELAY_MS', 'ANALYSIS_USER_DAILY_LIMIT', 'ANALYSIS_ADMIN_RETRY_COOLDOWN_SECONDS', 'ANALYSIS_ADMIN_DAILY_RETRY_LIMIT', 'ANALYSIS_RECONCILE_BUDGET_MS', 'ANALYSIS_RECONCILE_JOB_LIMIT']) {
  if (!new RegExp(`^${name}=`, 'm').test(example)) failures.push(`.env.example 缺少 ${name}。`);
}
if (/^VITE_(?:OPENAI|.*SERVICE_ROLE|.*INTERNAL_SECRET)/m.test(example)) failures.push('.env.example 不能把服务端密钥声明为 VITE_ 变量。');
if (!/preflightAnalysisJob/.test(analyzeEndpoint) || /enqueueAnalysisJob/.test(analyzeEndpoint)) failures.push('/api/analyze 必须只做配额预检和低延迟 dispatch。');
const storeClaim = analysisStore.match(/async claim\([\s\S]+?\n  }\n\n  private async referenceData/)?.[0] ?? '';
if (/\.insert\(/.test(storeClaim)) failures.push('分析 worker 不得在 claim 时临时创建 durable job。');
if (!/claim_analysis_job[\s\S]+?p_daily_limit:\s*this\.dailyLimit/.test(storeClaim)) failures.push('分析 worker claim 未传入最终用户日限额。');
if (!/PGRST202[\s\S]+?enqueue_analysis_job_with_quota/.test(analysisStore)) failures.push('Functions 缺少迁移前 enqueue RPC 兼容回退。');
if (!/PGRST202[\s\S]+?claim_analysis_job[\s\S]+?p_prompt_version:\s*this\.promptVersion/.test(analysisStore)) failures.push('Worker 缺少迁移前三参数 claim 兼容回退。');
if (!/backfill_orphan_analysis_jobs[\s\S]+?p_limit:\s*limits\.reconcileJobLimit/.test(reconciler)) failures.push('Reconciler 未在限额内补建孤儿 job。');
if (!/repaired\.error\s*&&\s*!isMissingRpcError\(repaired\.error\)/.test(reconciler)) failures.push('Reconciler 缺少迁移前 orphan RPC 兼容回退。');
const reconcilerLimits = reconciler.match(/const limits = readAnalysisRuntimeLimits\(\{[\s\S]+?\n  \}\);/)?.[0] ?? '';
if (!/ANALYSIS_USER_DAILY_LIMIT/.test(reconcilerLimits)) failures.push('Reconciler 的 claim 未读取配置的用户日限额。');
if (!/node scripts\/check-deploy-config\.mjs && tsc -b && vite build/.test(packageJson)) failures.push('部署配置 fail-closed 检查未纳入 build。');
if (!/CONTEXT[\s\S]+?production[\s\S]+?VITE_DATA_MODE[\s\S]+?supabase/.test(deployCheck) || !/exampleprojectref123/.test(deployCheck)) failures.push('Production Supabase 项目门禁不完整。');
if (!/deploy-preview[\s\S]+?VITE_DATA_MODE/.test(deployCheck)) failures.push('Deploy Preview 数据模式未要求显式选择。');
if (!/validAnalysisSourceCount:\s*analysisStatuses\.get\('complete'\)\s*\|\|\s*0/.test(dashboard)) failures.push('看板未单独返回完成分析来源数。');
if (!/sourceCount=\{dashboard\.validAnalysisSourceCount\}/.test(adminDemandPage)) failures.push('D2 样本提示未使用完成分析来源数。');
if (!/validAnalysisSourceCount:\s*currentResults\.length/.test(mockDashboard)) failures.push('Mock 看板未返回完成分析来源数。');
if (/Netlify[^\n]+env/.test(runtimeEnv)) failures.push('Node Functions 不得使用 Edge-only Netlify.env。');
if (!/process\?\.env/.test(runtimeEnv)) failures.push('Node Functions 未从 process.env 读取 Functions-scoped 变量。');
if (/envValue\('CONTEXT'\)/.test(functionRuntimeSources)) failures.push('Functions runtime 不得依赖 build-only CONTEXT。');
if (!/deploy\?\.context === 'production'/.test(runtimeEnv)) failures.push('Functions 未从调用上下文识别 Production deploy。');
if (!/preview-seed-preflight/.test(previewSeedPreflight) || !/method:\s*['"]GET['"]/.test(previewSeedPreflight)) failures.push('Preview seed preflight 必须是只读 GET Function。');
if (!/requireEnv\(['"]ANALYSIS_INTERNAL_SECRET['"]\)/.test(previewSeedPreflight)) failures.push('Preview seed preflight 缺少内部 secret 保护。');
if (!/branch-deploy/.test(previewSeedPreflight) || !/deploy-preview/.test(previewSeedPreflight)) failures.push('Preview seed preflight 缺少非生产 deploy context 白名单。');
if (!/exampleprojectref123/.test(previewSeedPreflight) || !/createRuntimeModelFactory/.test(previewSeedPreflight) || !/deterministic-mock/.test(previewSeedPreflight)) failures.push('Preview seed preflight 缺少项目与 mock 模型 fail-closed 校验。');

if (failures.length) {
  console.error('分析上线契约检查失败：');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('分析上线契约检查通过：store:false、运行时模型配置和公开环境变量边界均已确认。');
