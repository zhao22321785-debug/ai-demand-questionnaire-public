import { Link } from 'react-router-dom';

export function Brand() {
  return (
    <Link className="brand" to="/survey/identity" aria-label="返回 AI 需求调研首页">
      <span className="brand__mark" aria-hidden="true" />
      <span>AI 需求调研</span>
    </Link>
  );
}
