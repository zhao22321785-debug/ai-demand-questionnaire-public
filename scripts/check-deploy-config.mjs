import { pathToFileURL } from 'node:url';

const APPROVED_PROJECT_REF = 'exampleprojectref123';
const APPROVED_PRODUCTION_HOST = `${APPROVED_PROJECT_REF}.supabase.co`;

function validateSupabaseSelection(source, failures, requireApprovedProject) {
  const rawUrl = source.VITE_SUPABASE_URL?.trim();
  const publishableKey = source.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl) {
    failures.push('VITE_SUPABASE_URL 必须显式配置。');
  } else {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:' || url.username || url.password) {
        failures.push('VITE_SUPABASE_URL 必须是不含凭据的 HTTPS URL。');
      } else if (requireApprovedProject && url.hostname.toLowerCase() !== APPROVED_PRODUCTION_HOST) {
        failures.push(`VITE_SUPABASE_URL host 必须匹配项目 Reference ID ${APPROVED_PROJECT_REF}。`);
      }
    } catch {
      failures.push('VITE_SUPABASE_URL 必须是有效 URL。');
    }
  }
  if (!publishableKey) failures.push('VITE_SUPABASE_PUBLISHABLE_KEY 必须为非空 publishable key。');
}

export function validateDeployConfig(source = process.env) {
  const failures = [];
  const context = source.CONTEXT?.trim();
  const dataMode = source.VITE_DATA_MODE?.trim();

  if (context === 'production') {
    if (dataMode !== 'supabase') failures.push('Production 的 VITE_DATA_MODE 必须显式固定为 supabase。');
    validateSupabaseSelection(source, failures, true);
  } else if (context === 'deploy-preview') {
    if (dataMode !== 'mock' && dataMode !== 'supabase') {
      failures.push('Deploy Preview 的 VITE_DATA_MODE 必须显式选择 mock 或 supabase。');
    } else if (dataMode === 'supabase') {
      validateSupabaseSelection(source, failures, false);
    }
  } else if (dataMode === 'supabase') {
    validateSupabaseSelection(source, failures, false);
  }

  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = validateDeployConfig();
  if (failures.length) {
    console.error('部署配置检查失败：');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('部署配置检查通过：当前构建上下文的数据模式已明确。');
  }
}
