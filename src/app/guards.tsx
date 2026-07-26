import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PageState } from '../components/feedback/PageState';
import { useAuth } from '../features/auth/AuthProvider';

export function RequireUser() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageState title="正在确认登录状态" />;
  if (!user) return <Navigate replace state={{ from: location.pathname }} to="/survey/login" />;
  if (user.role !== 'user') return <Navigate replace to="/admin" />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageState title="正在确认管理员权限" />;
  if (!user) return <Navigate replace state={{ from: location.pathname }} to="/admin/login" />;
  if (user.role !== 'admin') return <Navigate replace to="/survey/identity" />;
  return <Outlet />;
}
