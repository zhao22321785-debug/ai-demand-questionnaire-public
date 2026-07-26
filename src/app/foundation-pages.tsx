import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/layout/AuthLayout';
import { SurveyLayout } from '../components/layout/SurveyLayout';
import { AdminFrame } from '../components/layout/AdminFrame';
import { PageState } from '../components/feedback/PageState';

function FoundationForm({ actionLabel }: { actionLabel: string }) {
  return (
    <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
      <label>
        <span>邮箱</span>
        <input autoComplete="email" name="email" placeholder="name@company.com" type="email" />
      </label>
      <label>
        <span>密码</span>
        <input autoComplete="current-password" name="password" placeholder="至少 8 位" type="password" />
      </label>
      <button className="text-action" type="submit">{actionLabel} <span aria-hidden="true">→</span></button>
    </form>
  );
}

export function SurveyLoginFoundationPage() {
  return (
    <AuthLayout title="继续填写需求调研" description="使用邮箱和密码进入您的答卷。">
      <FoundationForm actionLabel="登录" />
      <p className="auth-panel__switch">还没有账号？ <Link to="/survey/register">创建账号</Link></p>
    </AuthLayout>
  );
}

export function SurveyRegisterFoundationPage() {
  return (
    <AuthLayout title="创建调研账号" description="账号只用于保存和识别您的答卷。">
      <FoundationForm actionLabel="创建账号" />
      <p className="auth-panel__switch">已有账号？ <Link to="/survey/login">返回登录</Link></p>
    </AuthLayout>
  );
}

export function AdminLoginFoundationPage() {
  return (
    <AuthLayout title="管理员登录" description="查看本轮调研的原始答卷和分析状态。" footer="管理端不提供账号注册。">
      <FoundationForm actionLabel="进入管理端" />
    </AuthLayout>
  );
}

export function IdentityFoundationPage() {
  return (
    <SurveyLayout module="选择填写身份">
      <section className="identity-page">
        <p className="eyebrow">开始本次调研</p>
        <h1>您准备从哪个视角提供信息？</h1>
        <p>两个身份分别保存。同一个人可以根据实际情况填写两类问卷。</p>
        <div className="identity-options">
          <Link to="/survey/employee"><strong>普通员工</strong><span>从本人近期真实工作出发</span><b aria-hidden="true">→</b></Link>
          <Link to="/survey/position"><strong>岗位调研负责人</strong><span>从岗位职责和共性任务出发</span><b aria-hidden="true">→</b></Link>
        </div>
        <Link className="quiet-link" to="/survey/responses">查看我的答卷</Link>
      </section>
    </SurveyLayout>
  );
}

export function ProfileFoundationPage() {
  return (
    <SurveyLayout module="填写基本信息">
      <section className="profile-foundation">
        <p className="eyebrow">基本信息</p>
        <h1>先确认您的岗位背景</h1>
        <p>这些信息只用于理解答卷场景，不参与账号认证。</p>
        <PageState title="资料表单结构已就绪" description="登录接入后将在此保存姓名、部门、岗位和当前岗位经验。" />
      </section>
    </SurveyLayout>
  );
}

export function SurveyModuleFoundationPage({ title, description }: { title: string; description: string }) {
  return (
    <SurveyLayout module={title}>
      <section className="foundation-placeholder">
        <p className="eyebrow">M1 页面骨架</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <PageState title="共享接口已准备" description="该模块将在共享基础稳定后并行实现。" />
      </section>
    </SurveyLayout>
  );
}

export function AdminModuleFoundationPage({ title }: { title: string }) {
  return (
    <AdminFrame>
      <header className="admin-page-header"><p className="eyebrow">当前调研批次</p><h1>{title}</h1></header>
      <PageState title="管理页面骨架已准备" description="M1 只读答卷模块将在共享接口稳定后接入。" />
    </AdminFrame>
  );
}

export function NotFoundPage() {
  return (
    <main className="not-found"><p className="eyebrow">404</p><h1>没有找到这个页面</h1><Link to="/survey/login">返回登录</Link></main>
  );
}
