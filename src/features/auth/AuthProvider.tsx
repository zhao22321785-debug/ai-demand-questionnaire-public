import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/supabase';
import { publicEnv } from '../../lib/env';
import { AppError } from '../../lib/errors';
import type { SystemRole } from '../../types/survey';

const MOCK_AUTH_KEY = 'ai-demand-questionnaire:auth';

export interface AuthUser {
  id: string;
  email: string;
  role: SystemRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn(email: string, password: string, portal: 'survey' | 'admin'): Promise<void>;
  signUp(email: string, password: string): Promise<{ requiresConfirmation: boolean }>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readMockUser(): AuthUser | null {
  const raw = window.localStorage.getItem(MOCK_AUTH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

function writeMockUser(user: AuthUser | null): void {
  if (user) window.localStorage.setItem(MOCK_AUTH_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(MOCK_AUTH_KEY);
}

async function resolveSupabaseUser(user: User): Promise<AuthUser> {
  const client = getSupabaseClient();
  const { data, error } = await client.from('user_roles').select('role,status').eq('user_id', user.id).single();
  if (error) throw new AppError('无法读取账号权限', 'ROLE_LOOKUP_FAILED', error);
  if (data.status !== 'active') throw new AppError('账号已停用', 'ACCOUNT_DISABLED');
  return { id: user.id, email: user.email ?? '', role: data.role as SystemRole };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (publicEnv.dataMode === 'mock') {
      setUser(readMockUser());
      setLoading(false);
      return;
    }

    let active = true;
    const client = getSupabaseClient();
    void client.auth.getSession().then(async ({ data }) => {
      const nextUser = data.session?.user ? await resolveSupabaseUser(data.session.user) : null;
      if (active) setUser(nextUser);
    }).catch(() => { if (active) setUser(null); }).finally(() => { if (active) setLoading(false); });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        const nextUser = session?.user ? await resolveSupabaseUser(session.user) : null;
        if (active) setUser(nextUser);
      })();
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    async signIn(email, password, portal) {
      if (publicEnv.dataMode === 'mock') {
        const nextUser: AuthUser = { id: 'mock-user', email, role: portal === 'admin' ? 'admin' : 'user' };
        writeMockUser(nextUser); setUser(nextUser); return;
      }
      const client = getSupabaseClient();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user) throw new AppError('邮箱或密码不正确', 'SIGN_IN_FAILED', error);
      const nextUser = await resolveSupabaseUser(data.user);
      if (portal === 'admin' && nextUser.role !== 'admin') {
        await client.auth.signOut();
        throw new AppError('当前账号没有管理员权限', 'ADMIN_REQUIRED');
      }
      if (portal === 'survey' && nextUser.role !== 'user') {
        await client.auth.signOut();
        throw new AppError('管理员账号请从管理端入口登录', 'SURVEY_USER_REQUIRED');
      }
      setUser(nextUser);
    },
    async signUp(email, password) {
      if (publicEnv.dataMode === 'mock') {
        const nextUser: AuthUser = { id: 'mock-user', email, role: 'user' };
        writeMockUser(nextUser); setUser(nextUser);
        return { requiresConfirmation: false };
      }
      const client = getSupabaseClient();
      const { data, error } = await client.auth.signUp({ email, password });
      if (error || !data.user) throw new AppError('账号创建失败，请检查邮箱和密码', 'SIGN_UP_FAILED', error);
      if (data.session) setUser(await resolveSupabaseUser(data.user));
      return { requiresConfirmation: !data.session };
    },
    async signOut() {
      if (publicEnv.dataMode === 'mock') writeMockUser(null);
      else await getSupabaseClient().auth.signOut();
      setUser(null);
    },
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}
