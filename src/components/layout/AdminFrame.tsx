import type { PropsWithChildren } from 'react';
import { NavLink } from 'react-router-dom';

const navigation = [
  { group: '分析', items: [{ label: '数据总览', to: '/admin', end: true }, { label: '需求分析', to: '/admin/demands' }, { label: '证据对比', to: '/admin/differences' }] },
  { group: '答卷', items: [{ label: '员工答卷', to: '/admin/employee-responses' }, { label: '负责人答卷', to: '/admin/position-responses' }] },
];

export function AdminFrame({ children }: PropsWithChildren) {
  return (
    <div className="admin-frame">
      <aside className="admin-nav">
        <div className="admin-nav__brand"><span aria-hidden="true">AI</span><div>AI 需求调研<small>只读分析端</small></div></div>
        <nav aria-label="管理端导航">
          {navigation.map((section) => <div className="admin-nav__group" key={section.group}><p className="admin-nav__section">{section.group}</p>{section.items.map((item) => <NavLink key={item.to} end={item.end} className={({ isActive }) => `admin-nav__link${isActive ? ' is-active' : ''}`} to={item.to}>{item.label}</NavLink>)}</div>)}
        </nav>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
