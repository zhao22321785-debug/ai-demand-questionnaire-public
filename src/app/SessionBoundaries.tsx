import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';

export function SurveySessionBoundary() {
  const { signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = `${location.pathname}${location.search}`;
  const profileTarget = location.pathname === '/survey/profile'
    ? '/survey/profile'
    : `/survey/profile?returnTo=${encodeURIComponent(returnTo)}`;
  return <><div className="session-controls"><Link to={profileTarget}>基本资料</Link><Link to="/survey/responses">我的答卷</Link><button type="button" onClick={() => void signOut().then(() => navigate('/survey/login'))}>退出登录</button></div><Outlet /></>;
}

export function AdminSessionBoundary() {
  const { signOut } = useAuth(); const navigate = useNavigate();
  return <><div className="session-controls session-controls--admin"><button type="button" onClick={() => void signOut().then(() => navigate('/admin/login'))}>退出管理端</button></div><Outlet /></>;
}
