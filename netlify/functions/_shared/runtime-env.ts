interface NodeRuntimeGlobal {
  process?: { env?: Record<string, string | undefined> };
}

export function envValue(name: string): string | undefined {
  return (globalThis as typeof globalThis & NodeRuntimeGlobal).process?.env?.[name];
}

export interface FunctionRuntimeContext {
  deploy?: { context?: string };
}

export function isProductionRuntime(context?: FunctionRuntimeContext): boolean {
  return context?.deploy?.context === 'production';
}

export function requireEnv(name: string): string {
  const value = envValue(name);
  if (!value) throw new Error(`服务端环境变量 ${name} 未配置`);
  return value;
}
