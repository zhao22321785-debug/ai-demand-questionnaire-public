import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import { SurveyLayout } from '../../components/layout/SurveyLayout';
import { useDataClient } from '../../lib/data';
import { isCompleteUserProfile } from './profile-validation';
import type { ExperienceRange, ReferenceData, UserProfileInput } from '../../types/survey';

const emptyProfile: UserProfileInput = { name: '', currentPositionExperience: '1_3' };

export function ProfilePage() {
  const client = useDataClient(); const navigate = useNavigate(); const [searchParams] = useSearchParams();
  const [reference, setReference] = useState<ReferenceData | null>(null); const [profile, setProfile] = useState<UserProfileInput>(emptyProfile);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('');

  useEffect(() => { let active = true; void Promise.all([client.getReferenceData(), client.getProfile()]).then(([nextReference, nextProfile]) => { if (!active) return; setReference(nextReference); if (nextProfile) setProfile(nextProfile); }).catch(() => { if (active) setError('暂时无法读取资料，请稍后刷新。'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [client]);
  if (loading) return <SurveyLayout module="填写基本信息"><PageState title="正在读取资料" /></SurveyLayout>;
  if (!reference) return <SurveyLayout module="填写基本信息"><PageState tone="danger" title={error || '资料页暂不可用'} /></SurveyLayout>;
  const otherDepartment = profile.departmentId === 'other'; const otherPosition = profile.positionId === 'other';

  async function save() {
    if (!isCompleteUserProfile(profile)) { setError('请填写姓名、部门、岗位和当前岗位经验。'); return; }
    setSaving(true); setError('');
    try { await client.saveProfile(profile); const returnTo = searchParams.get('returnTo'); navigate(returnTo?.startsWith('/survey/') ? returnTo : '/survey/identity'); }
    catch { setError('保存未完成，请稍后重试。'); setSaving(false); }
  }

  return <SurveyLayout module="填写基本信息"><section className="profile-page"><p className="eyebrow">基本信息</p><h1>先确认您的岗位背景</h1><p>这些信息只用于理解答卷场景，不参与账号认证。</p><div className="profile-form"><label>姓名<input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label><label>所属部门<select value={profile.departmentId ?? ''} onChange={(event) => setProfile({ ...profile, departmentId: event.target.value || undefined, departmentOther: event.target.value === 'other' ? profile.departmentOther : undefined })}><option value="">请选择</option>{reference.departments.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{otherDepartment ? <label>其他部门<input value={profile.departmentOther ?? ''} onChange={(event) => setProfile({ ...profile, departmentOther: event.target.value })} /></label> : null}<label>岗位名称<select value={profile.positionId ?? ''} onChange={(event) => setProfile({ ...profile, positionId: event.target.value || undefined, positionOther: event.target.value === 'other' ? profile.positionOther : undefined })}><option value="">请选择</option>{reference.positions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{otherPosition ? <label>其他岗位<input value={profile.positionOther ?? ''} onChange={(event) => setProfile({ ...profile, positionOther: event.target.value })} /></label> : null}<label>当前岗位经验<select value={profile.currentPositionExperience} onChange={(event) => setProfile({ ...profile, currentPositionExperience: event.target.value as ExperienceRange })}><option value="under_1">1 年以内</option><option value="1_3">1–3 年</option><option value="3_5">3–5 年</option><option value="5_10">5–10 年</option><option value="over_10">10 年以上</option></select></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="text-action" disabled={saving} onClick={() => void save()} type="button">{saving ? '正在保存…' : '保存并继续 →'}</button></div></section></SurveyLayout>;
}
