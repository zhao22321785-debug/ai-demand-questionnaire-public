import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageState } from '../../components/feedback/PageState';
import { TextAction } from '../../components/form/TextAction';
import { StepLayout } from '../../components/form/StepLayout';
import { useDataClient } from '../../lib/data';
import type {
  AiParticipation, ExperienceRange, OccurrencePattern, PositionSurveyInput, PositionTaskDemandInput,
  PositionWorkItemInput, ResultUsage, StepStability,
} from '../../types/survey';

const occurrenceOptions: Array<{ value: OccurrencePattern; label: string }> = [
  { value: 'daily', label: '几乎每天发生' }, { value: 'weekly', label: '每周会发生' },
  { value: 'monthly_stage', label: '按月或阶段性发生' }, { value: 'project_event', label: '随项目或事件发生' },
  { value: 'irregular', label: '没有固定规律' }, { value: 'unknown', label: '暂不确定' },
];
const stabilityOptions: Array<{ value: StepStability; label: string }> = [
  { value: 'fixed', label: '步骤基本固定' }, { value: 'partly_fixed', label: '部分步骤固定' },
  { value: 'variable', label: '每次情况不同' }, { value: 'unknown', label: '暂不确定' },
];

function id(): string { return globalThis.crypto.randomUUID(); }
function blankWork(): PositionWorkItemInput { return { id: id(), name: '', description: '', selectedForImprovement: false }; }
function blankTask(workItemId: string): PositionTaskDemandInput {
  return { id: id(), workItemId, task: '', commonInput: '', hasFixedInput: true, output: '', hasFixedOutput: true,
    currentProcess: '', mainProblem: '', occurrence: 'unknown', stability: 'unknown', audience: 'unknown', aiParticipation: 'unknown',
    expectedAiSupport: '', resultUsage: 'unknown', requiresCollaboration: false, collaborationDepartments: [], collaborationPositions: [] };
}
function updateAt<T>(items: T[], index: number, value: T): T[] { return items.map((item, current) => current === index ? value : item); }

interface PositionIdentitySnapshot {
  readonly batchId: string;
  readonly positionKey: string;
  readonly positionId?: string;
  readonly positionName: string;
  readonly positionOther?: string;
}

export function PositionSurveyPage() {
  const client = useDataClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState<Awaited<ReturnType<typeof client.getReferenceData>> | null>(null);
  const [researcherName, setResearcherName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [departmentOther, setDepartmentOther] = useState('');
  const [positionId, setPositionId] = useState('');
  const [positionOther, setPositionOther] = useState('');
  const [positionName, setPositionName] = useState('');
  const [experience, setExperience] = useState<ExperienceRange>('1_3');
  const [loadedEditId, setLoadedEditId] = useState<string | null>(null);
  const [editIdentity, setEditIdentity] = useState<PositionIdentitySnapshot | null>(null);
  const [workItems, setWorkItems] = useState<PositionWorkItemInput[]>([blankWork(), blankWork()]);
  const [tasks, setTasks] = useState<PositionTaskDemandInput[]>([]);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const data = await client.getReferenceData();
        if (!active) return;
        setReference(data);
        if (!editId) return;
        const record = await client.getPositionResponse(editId);
        if (!active) return;
        if (!record) { setError('未找到需要修改的岗位答卷。'); return; }
        const input = record.input;
        setResearcherName(input.researcherName);
        setDepartmentId(input.departmentId ?? '');
        setDepartmentOther(input.departmentOther ?? '');
        setPositionId(input.positionId ?? '');
        setPositionOther(input.positionOther ?? '');
        setPositionName(input.positionName);
        setExperience(input.relatedPositionExperience);
        setWorkItems(input.workItems);
        setTasks(input.taskDemands);
        setLoadedEditId(editId);
        setEditIdentity(Object.freeze({
          batchId: record.batchId,
          positionKey: record.positionKey,
          positionId: input.positionId,
          positionName: input.positionName,
          positionOther: input.positionOther,
        }));
      } catch { if (active) setError(editId ? '暂时无法读取待修改答卷，请稍后重试。' : '暂时无法读取问卷配置，请稍后重试。'); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [client, editId]);
  const selectedWork = useMemo(() => workItems.filter((item) => item.selectedForImprovement), [workItems]);
  const maxStep = 3;
  const selectedPositionLabel = positionId === 'other' ? positionOther : reference?.positions.find((item) => item.id === positionId)?.label ?? '';
  const isEditing = Boolean(editId && loadedEditId === editId);
  const hasInvalidEditIdentity = isEditing && (!editIdentity || !editIdentity.batchId.trim() || !editIdentity.positionKey.trim() || !editIdentity.positionName.trim());
  const isHistoricalEdit = Boolean(isEditing && editIdentity && editIdentity.batchId.trim() && reference && editIdentity.batchId !== reference.activeBatch.id);

  const next = () => {
    setError('');
    if (step === 0 && (!researcherName.trim() || !positionName.trim() || !positionId || !departmentId)) return setError('请填写负责人、调研岗位名称，并选择岗位类别和所属部门。');
    if (step === 0 && ((positionId === 'other' && !positionOther.trim()) || (departmentId === 'other' && !departmentOther.trim()))) return setError('选择“其他”岗位或部门时，请补充具体名称。');
    if (step === 1 && (workItems.length < 2 || workItems.length > 5 || workItems.some((item) => !item.name.trim() || !item.description.trim()))) return setError('请填写 2–5 项岗位主要工作，并补充每项工作说明。');
    if (step === 1 && (selectedWork.length < 1 || selectedWork.length > 3)) return setError('请选择 1–3 项希望改进的主要工作。');
    if (step === 2 && (tasks.length < 1 || tasks.length > 3)) return setError('请填写 1–3 项岗位共性任务。');
    if (step === 2 && tasks.some((item) => !validTask(item, selectedWork))) return setError('请补齐任务关联、输入输出、当前做法、问题、AI 支持以及适用的人工确认或协作条件。');
    setStep((value) => Math.min(maxStep, value + 1));
  };
  const save = async () => {
    if (!reference) return;
    if (editId && (!isEditing || !editIdentity || !editIdentity.batchId.trim() || !editIdentity.positionKey.trim() || !editIdentity.positionName.trim())) {
      setError('答卷身份无法确认，本次修改不会保存。');
      return;
    }
    if (isHistoricalEdit) {
      setError('历史答卷暂不可修改，请返回当前调研批次重新填写。');
      return;
    }
    setSaving(true); setError('');
    const savedPositionIdentity = editIdentity ?? {
      positionId,
      positionName,
      positionOther: positionId === 'other' ? positionOther : undefined,
    };
    const input: PositionSurveyInput = { batchId: reference.activeBatch.id, surveyVersionId: reference.activeBatch.positionSurveyVersionId, researcherName: researcherName.trim(),
      departmentId: departmentId || undefined, departmentOther: departmentId === 'other' ? departmentOther.trim() || undefined : undefined,
      positionId: savedPositionIdentity.positionId, positionOther: savedPositionIdentity.positionOther?.trim() || undefined,
      positionName: savedPositionIdentity.positionName.trim(), relatedPositionExperience: experience,
      workItems, taskDemands: tasks };
    try { const saved = await client.savePositionSurvey(input); navigate(`/survey/responses/position/${saved.id}`); }
    catch { setError('保存未完成，请检查网络后重试。'); }
    finally { setSaving(false); }
  };
  const setWork = (index: number, change: Partial<PositionWorkItemInput>) => {
    const current = workItems[index];
    if (change.selectedForImprovement === false && current.selectedForImprovement && tasks.some((task) => task.workItemId === current.id)) {
      setError('这项主要工作已被岗位任务引用，请先调整任务关联。');
      return;
    }
    setWorkItems((items) => updateAt(items, index, { ...items[index], ...change }));
  };
  const removeWork = (index: number) => {
    const current = workItems[index];
    if (tasks.some((task) => task.workItemId === current.id)) {
      setError('这项主要工作已被岗位任务引用，请先调整任务关联。');
      return;
    }
    setWorkItems((items) => items.filter((_, currentIndex) => currentIndex !== index));
  };
  const setTask = (index: number, change: Partial<PositionTaskDemandInput>) => setTasks((items) => updateAt(items, index, { ...items[index], ...change }));

  if (loading) return <StepLayout module="岗位需求调研" progress="加载中" title="正在准备问卷"><PageState title="正在读取岗位与部门配置" /></StepLayout>;
  if (!reference) return <StepLayout module="岗位需求调研" progress="无法开始" title="问卷暂不可用"><PageState tone="danger" title={error || '无法读取问卷配置'} /></StepLayout>;
  if (editId && loadedEditId !== editId) return <StepLayout module="岗位需求调研" progress="无法载入" title="暂时无法载入原答卷"><PageState tone="danger" title={error || '未找到需要修改的岗位答卷'} description="请返回岗位复盘后重试；不会创建或覆盖任何答卷。" /></StepLayout>;
  if (hasInvalidEditIdentity) return <StepLayout module="岗位需求调研" progress="身份异常" title="答卷身份无法确认"><PageState tone="danger" title="答卷身份无法确认" description="这份答卷缺少完整的批次或岗位身份，不能修改或保存。请返回岗位复盘后重试。" /></StepLayout>;
  if (isHistoricalEdit) return <StepLayout module="岗位需求调研" progress="历史答卷" title="历史答卷暂不可修改"><PageState tone="danger" title="历史答卷暂不可修改" description="这份答卷不属于当前调研批次，不能修改或保存。请返回当前调研批次重新填写。" /></StepLayout>;
  const actions = <><TextAction direction="back" disabled={step === 0 || saving} onClick={() => { setError(''); setStep((value) => Math.max(0, value - 1)); }}>上一项</TextAction>{step < maxStep ? <TextAction disabled={saving} onClick={next}>下一项</TextAction> : <TextAction disabled={saving} onClick={save}>{saving ? '正在保存' : '保存答卷'}</TextAction>}</>;
  return <StepLayout module="岗位需求调研" progress={`${step + 1} / ${maxStep + 1}`} title={['确认调研岗位', '梳理岗位主要工作', '填写岗位共性任务', '确认并保存'][step]} description={['一份答卷只对应一个岗位。资料仅用于理解填写背景。', '先列出岗位常见的主要工作，再选择最希望改进的内容。', '每项任务必须关联已选择的主要工作，避免把不同工作混在一起。', '保存后原始答卷立即有效；分析准备期间，您仍可查看和修改答卷。'][step]} actions={actions}>
    {error ? <PageState tone="danger" title={error} /> : null}
    {step === 0 ? <div className="position-form"><label>负责人姓名<input value={researcherName} onChange={(event) => setResearcherName(event.target.value)} /></label><label>调研岗位名称<input disabled={isEditing} value={positionName} onChange={(event) => setPositionName(event.target.value)} placeholder="例如：产品经理" /></label><label>岗位类别<select disabled={isEditing} value={positionId} onChange={(event) => setPositionId(event.target.value)}><option value="">请选择</option>{reference.positions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{positionId === 'other' ? <label>其他岗位类别<input disabled={isEditing} value={positionOther} onChange={(event) => setPositionOther(event.target.value)} /></label> : null}<label>所属部门<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">请选择</option>{reference.departments.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{departmentId === 'other' ? <label>其他部门<input value={departmentOther} onChange={(event) => setDepartmentOther(event.target.value)} /></label> : null}<label>了解该岗位的经验<select value={experience} onChange={(event) => setExperience(event.target.value as ExperienceRange)}><option value="under_1">1 年以内</option><option value="1_3">1–3 年</option><option value="3_5">3–5 年</option><option value="5_10">5–10 年</option><option value="over_10">10 年以上</option></select></label></div> : null}
    {step === 1 ? <div className="position-form">{workItems.map((item, index) => <fieldset key={item.id}><legend>主要工作 {index + 1}</legend><label>工作名称<input value={item.name} onChange={(event) => setWork(index, { name: event.target.value })} placeholder="例如：需求调研与方案梳理" /></label><label>工作说明<textarea value={item.description} onChange={(event) => setWork(index, { description: event.target.value })} /></label><label><input checked={item.selectedForImprovement} type="checkbox" onChange={(event) => setWork(index, { selectedForImprovement: event.target.checked })} /> 希望优先改进这项工作</label>{workItems.length > 2 ? <button type="button" onClick={() => removeWork(index)}>移除此项</button> : null}</fieldset>)}{workItems.length < 5 ? <TextAction onClick={() => setWorkItems((items) => [...items, blankWork()])}>添加主要工作</TextAction> : null}</div> : null}
    {step === 2 ? <div className="position-form">{tasks.map((task, index) => <TaskCard key={task.id} index={index} task={task} works={selectedWork} onChange={(change) => setTask(index, change)} onRemove={() => setTasks((items) => items.filter((_, current) => current !== index))} removable={tasks.length > 1} />)}{tasks.length < 3 ? <TextAction onClick={() => setTasks((items) => [...items, blankTask(selectedWork[0]?.id ?? '')])}>添加岗位共性任务</TextAction> : null}{tasks.length === 0 ? <PageState title="请添加 1–3 项岗位共性任务" description="例如：整理业务信息、审核交付物或跨团队协调。" /> : null}</div> : null}
    {step === 3 ? <div className="position-form"><PageState tone="success" title={`即将保存「${positionName}」岗位答卷`} description={`已选择 ${selectedWork.length} 项改进工作，并填写 ${tasks.length} 项岗位共性任务。保存后不生成岗位总分。`} /><dl><dt>岗位类别</dt><dd>{selectedPositionLabel || '未填写'}</dd><dt>任务关联</dt><dd>{tasks.map((task) => `${task.task || '未命名任务'} → ${selectedWork.find((work) => work.id === task.workItemId)?.name || '未关联'}`).join('；')}</dd></dl></div> : null}
  </StepLayout>;
}

function TaskCard({ index, task, works, onChange, onRemove, removable }: { index: number; task: PositionTaskDemandInput; works: PositionWorkItemInput[]; onChange: (change: Partial<PositionTaskDemandInput>) => void; onRemove: () => void; removable: boolean }) {
  return <fieldset><legend>岗位共性任务 {index + 1}</legend><label>关联的主要工作<select value={task.workItemId} onChange={(event) => onChange({ workItemId: event.target.value })}><option value="">请选择</option>{works.map((item) => <option key={item.id} value={item.id}>{item.name || '未命名主要工作'}</option>)}</select></label><label>任务名称<input value={task.task} onChange={(event) => onChange({ task: event.target.value })} placeholder="描述岗位中反复出现的具体任务" /></label><label>常见输入<input disabled={!task.hasFixedInput} value={task.commonInput} onChange={(event) => onChange({ commonInput: event.target.value })} placeholder="材料、数据、需求或触发条件" /></label><label><input checked={!task.hasFixedInput} type="checkbox" onChange={(event) => onChange({ hasFixedInput: !event.target.checked, commonInput: event.target.checked ? '' : task.commonInput })} /> 无固定输入</label><label>常见输出<input disabled={!task.hasFixedOutput} value={task.output} onChange={(event) => onChange({ output: event.target.value })} placeholder="交付物、决定或后续动作" /></label><label><input checked={!task.hasFixedOutput} type="checkbox" onChange={(event) => onChange({ hasFixedOutput: !event.target.checked, output: event.target.checked ? '' : task.output })} /> 无固定输出</label><label>当前做法<textarea value={task.currentProcess} onChange={(event) => onChange({ currentProcess: event.target.value })} /></label><label>主要问题<textarea value={task.mainProblem} onChange={(event) => onChange({ mainProblem: event.target.value })} /></label><SelectField label="发生规律" value={task.occurrence} options={occurrenceOptions} onChange={(value) => onChange({ occurrence: value as OccurrencePattern })} /><SelectField label="步骤稳定程度" value={task.stability} options={stabilityOptions} onChange={(value) => onChange({ stability: value as StepStability })} /><SelectField label="覆盖人群" value={task.audience} options={[{ value: 'single', label: '少数固定人员' }, { value: 'same_position', label: '同岗位多数人员' }, { value: 'cross_function', label: '跨岗位协作人员' }, { value: 'unknown', label: '暂不确定' }]} onChange={(value) => onChange({ audience: value as PositionTaskDemandInput['audience'] })} /><SelectField label="希望 AI 如何参与" value={task.aiParticipation} options={[{ value: 'reference', label: '提供参考' }, { value: 'assist', label: '辅助完成部分工作' }, { value: 'partial_automation', label: '自动完成部分固定步骤' }, { value: 'mostly_automated', label: '承担大部分重复工作' }, { value: 'unknown', label: '暂不确定' }]} onChange={(value) => onChange({ aiParticipation: value as AiParticipation })} /><label>希望获得的具体支持<textarea value={task.expectedAiSupport} onChange={(event) => onChange({ expectedAiSupport: event.target.value })} /></label><SelectField label="结果如何使用" value={task.resultUsage} options={[{ value: 'direct', label: '可直接用于后续工作' }, { value: 'human_review', label: '需要人工审核后使用' }, { value: 'reference_only', label: '仅作为参考' }, { value: 'unknown', label: '暂不确定' }]} onChange={(value) => onChange({ resultUsage: value as ResultUsage })} />{task.resultUsage === 'human_review' || task.resultUsage === 'reference_only' ? <label>人工确认的内容或条件<textarea value={task.humanReviewContent ?? ''} onChange={(event) => onChange({ humanReviewContent: event.target.value })} /></label> : null}<label><input checked={task.requiresCollaboration} type="checkbox" onChange={(event) => onChange({ requiresCollaboration: event.target.checked })} /> 需要与其他部门或岗位协作</label>{task.requiresCollaboration ? <><label>协作部门（用顿号分隔）<input value={task.collaborationDepartments.join('、')} onChange={(event) => onChange({ collaborationDepartments: event.target.value.split('、').map((value) => value.trim()).filter(Boolean) })} /></label><label>协作岗位（用顿号分隔）<input value={task.collaborationPositions.join('、')} onChange={(event) => onChange({ collaborationPositions: event.target.value.split('、').map((value) => value.trim()).filter(Boolean) })} /></label><label>交接内容或条件<textarea value={task.handoffContent ?? ''} onChange={(event) => onChange({ handoffContent: event.target.value })} /></label><label>协作中的主要问题<textarea value={task.collaborationProblem ?? ''} onChange={(event) => onChange({ collaborationProblem: event.target.value })} /></label><label>希望 AI 提供的协作支持<textarea value={task.collaborationAiSupport ?? ''} onChange={(event) => onChange({ collaborationAiSupport: event.target.value })} /></label></> : null}{removable ? <button type="button" onClick={onRemove}>移除此任务</button> : null}</fieldset>;
}
function validTask(task: PositionTaskDemandInput, selectedWork: PositionWorkItemInput[]): boolean {
  if (!selectedWork.some((work) => work.id === task.workItemId) || !task.task.trim() || !task.currentProcess.trim() || !task.mainProblem.trim() || !task.expectedAiSupport.trim()) return false;
  if ((task.hasFixedInput && !task.commonInput.trim()) || (task.hasFixedOutput && !task.output.trim())) return false;
  if ((task.resultUsage === 'human_review' || task.resultUsage === 'reference_only') && !task.humanReviewContent?.trim()) return false;
  if (!task.requiresCollaboration) return true;
  return (task.collaborationDepartments.length > 0 || task.collaborationPositions.length > 0) && Boolean(task.handoffContent?.trim()) && Boolean(task.collaborationProblem?.trim()) && Boolean(task.collaborationAiSupport?.trim());
}
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) { return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
