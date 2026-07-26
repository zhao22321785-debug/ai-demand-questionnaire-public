import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { PageState } from '../../components/feedback/PageState';
import { getErrorMessage } from '../../lib/errors';
import { useAuth } from './AuthProvider';

const loginSchema = z.object({ email: z.email('请输入有效邮箱'), password: z.string().min(8, '密码至少 8 位') });
const registerSchema = loginSchema.extend({ confirmPassword: z.string() }).refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], message: '两次输入的密码不一致' });
type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

function FieldError({ message }: { message?: string }) { return message ? <small className="field-error">{message}</small> : null; }

export function SurveyLoginPage() {
  const { user, signIn } = useAuth(); const navigate = useNavigate(); const [error, setError] = useState('');
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  if (user) return <Navigate replace to={user.role === 'admin' ? '/admin' : '/survey/identity'} />;
  return <AuthLayout title="继续填写需求调研" description="使用邮箱和密码进入您的答卷。"><form className="auth-form" onSubmit={form.handleSubmit(async (values) => { setError(''); try { await signIn(values.email, values.password, 'survey'); navigate('/survey/identity'); } catch (cause) { setError(getErrorMessage(cause)); } })}><label><span>邮箱</span><input autoComplete="email" type="email" {...form.register('email')} /><FieldError message={form.formState.errors.email?.message} /></label><label><span>密码</span><input autoComplete="current-password" type="password" {...form.register('password')} /><FieldError message={form.formState.errors.password?.message} /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="text-action" disabled={form.formState.isSubmitting} type="submit">{form.formState.isSubmitting ? '正在登录…' : '登录 →'}</button></form><p className="auth-panel__switch">还没有账号？ <Link to="/survey/register">创建账号</Link></p></AuthLayout>;
}

export function SurveyRegisterPage() {
  const { user, signUp } = useAuth(); const navigate = useNavigate(); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const form = useForm<RegisterValues>({ resolver: zodResolver(registerSchema), defaultValues: { email: '', password: '', confirmPassword: '' } });
  if (user) return <Navigate replace to={user.role === 'admin' ? '/admin' : '/survey/profile'} />;
  return <AuthLayout title="创建调研账号" description="账号只用于保存和识别您的答卷。"><form className="auth-form" onSubmit={form.handleSubmit(async (values) => { setError(''); setNotice(''); try { const result = await signUp(values.email, values.password); if (result.requiresConfirmation) setNotice('账号已创建，请先完成邮箱确认后登录。'); else navigate('/survey/profile'); } catch (cause) { setError(getErrorMessage(cause)); } })}><label><span>邮箱</span><input autoComplete="email" type="email" {...form.register('email')} /><FieldError message={form.formState.errors.email?.message} /></label><label><span>密码</span><input autoComplete="new-password" type="password" {...form.register('password')} /><FieldError message={form.formState.errors.password?.message} /></label><label><span>确认密码</span><input autoComplete="new-password" type="password" {...form.register('confirmPassword')} /><FieldError message={form.formState.errors.confirmPassword?.message} /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <PageState tone="success" title={notice} /> : null}<button className="text-action" disabled={form.formState.isSubmitting} type="submit">{form.formState.isSubmitting ? '正在创建…' : '创建账号 →'}</button></form><p className="auth-panel__switch">已有账号？ <Link to="/survey/login">返回登录</Link></p></AuthLayout>;
}

export function AdminLoginPage() {
  const { user, signIn } = useAuth(); const navigate = useNavigate(); const [error, setError] = useState('');
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  if (user?.role === 'admin') return <Navigate replace to="/admin" />;
  return <AuthLayout title="管理员登录" description="查看本轮调研的原始答卷和分析状态。" footer="管理端不提供账号注册。"><form className="auth-form" onSubmit={form.handleSubmit(async (values) => { setError(''); try { await signIn(values.email, values.password, 'admin'); navigate('/admin'); } catch (cause) { setError(getErrorMessage(cause)); } })}><label><span>管理员邮箱</span><input autoComplete="email" type="email" {...form.register('email')} /><FieldError message={form.formState.errors.email?.message} /></label><label><span>密码</span><input autoComplete="current-password" type="password" {...form.register('password')} /><FieldError message={form.formState.errors.password?.message} /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="text-action" disabled={form.formState.isSubmitting} type="submit">{form.formState.isSubmitting ? '正在验证…' : '进入管理端 →'}</button></form></AuthLayout>;
}
