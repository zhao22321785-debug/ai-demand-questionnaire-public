import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const distDirectory = resolve(process.cwd(), 'dist');
const forbiddenVariableNames = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'ANALYSIS_INTERNAL_SECRET',
  'NETLIFY_AUTH_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
];
const forbiddenValuePatterns = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /sb_secret_[A-Za-z0-9_-]{16,}/g,
];
const jwtPattern = /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g;

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function isServiceRoleJwt(value) {
  try {
    const payload = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).role === 'service_role';
  } catch {
    return false;
  }
}

if (!existsSync(distDirectory)) {
  console.error('未找到 dist：请先运行 npm run build，再执行 npm run check:secrets。');
  process.exit(1);
}

const findings = [];
for (const file of listFiles(distDirectory)) {
  const content = readFileSync(file, 'utf8');
  for (const variableName of forbiddenVariableNames) {
    if (content.includes(variableName)) findings.push(`${file}: 检测到服务端变量名 ${variableName}`);
  }
  for (const pattern of forbiddenValuePatterns) {
    const matches = content.match(pattern);
    if (matches) findings.push(`${file}: 检测到疑似真实密钥形态 ${matches[0].slice(0, 12)}…`);
  }
  for (const value of content.match(jwtPattern) ?? []) {
    if (isServiceRoleJwt(value)) findings.push(`${file}: 检测到 service_role JWT`);
  }
}

if (findings.length) {
  console.error('前端构建包含不应公开的服务端配置或疑似密钥：');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`客户端密钥检查通过：已扫描 dist 下 ${listFiles(distDirectory).length} 个文件。`);
