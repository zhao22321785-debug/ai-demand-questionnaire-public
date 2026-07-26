import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { OptionList } from '../../components/form/OptionList';
import { StepLayout } from '../../components/form/StepLayout';
import { TextAction } from '../../components/form/TextAction';
import { PageState } from '../../components/feedback/PageState';
import { useDataClient } from '../../lib/data';
import { employeeDimensionDefinitions } from '../../lib/survey/employee-dimensions';
import { isCompleteUserProfile } from '../profile/profile-validation';
import type {
  DimensionAnswer,
  EmployeeAiUseStatus,
  EmployeeAudience,
  EmployeeSurveyInput,
  EmployeeTaskDemandInput,
  OccurrencePattern,
  ReferenceData,
  StepStability,
  UserProfileInput,
} from '../../types/survey';
import './employee-survey.css';

type Step = 'ai-status' | 'ai-detail' | 'pain-points' | 'demand' | 'tasks' | 'dimensions';

const steps: Step[] = ['ai-status', 'ai-detail', 'pain-points', 'demand', 'tasks', 'dimensions'];

const aiStatusOptions = [
  { value: 'frequent', label: '经常使用' },
  { value: 'sometimes', label: '有时使用' },
  { value: 'tried_rarely', label: '尝试过，但很少使用' },
  { value: 'never', label: '还没有使用过' },
];

const nonUseReasonOptions = ['不清楚可以从哪些工作开始', '没有合适的工具或使用权限', '担心数据安全或合规问题', '暂时没有发现适合的工作', '没有时间或机会尝试', '其他'];
const discontinuationReasonOptions = ['结果不够稳定', '使用过程比较麻烦', '准备材料或数据不方便', '工具或权限受限', '对实际工作帮助不明显', '担心数据安全或合规问题', '其他'];
const scenarioOptions = ['查找、阅读或整理资料', '撰写、修改或翻译内容', '数据处理与分析', '制作方案、汇报或演示材料', '编程、测试或技术排查', '会议记录与沟通协作', '处理重复操作或工作流程', '其他'];
const painPointOptions = ['重复操作多或步骤繁琐', '查找、整理资料比较耗时', '容易出错或反复返工', '很依赖个人经验或判断', '跨部门、岗位沟通或交接不顺', '其他'];

const dimensionQuestions = [
  { title: employeeDimensionDefinitions[0].question, options: ['不清楚 AI 能做什么，通常不会考虑它是否适合这项工作。', '能识别搜索、写作、翻译等少数常见场景，但面对具体工作时主要凭感觉判断。', '遇到重复、耗时或需要整理信息的工作时，会判断 AI 能否提供帮助。', '能结合任务目标、信息敏感性和出错影响，判断哪些环节适合 AI、哪些必须由人完成。', '能主动发现有价值的 AI 使用场景，并明确 AI 的作用范围、人工确认点和不适用情况。'] },
  { title: employeeDimensionDefinitions[1].question, options: ['先告诉 AI 想让它做什么，AI 追问或结果不合适时再补充信息。', '把现有材料提供给 AI，并大致说明需要它处理什么。', '先说明任务目标和结果用途，再提供相关材料。', '开始前会说明目标、材料、输出要求和不能改变的限制。', '这类任务已有固定的信息清单或任务模板，其中包含目标、材料、输出要求和限制；每次会按实际任务补齐后再交给 AI。'] },
  { title: employeeDimensionDefinitions[2].question, options: ['让 AI 重新生成一次，再从不同结果中选择更接近需要的。', '指出需要修改的部分，让 AI 在原结果上调整。', '说明结果与需求的差距，并补充缺少的背景或要求。', '在说明差距和补充信息的基础上，会把任务拆成几个步骤，逐步确认中间结果后继续。', '在分步推进的基础上，会根据每一步结果决定继续、返回、换一种方式或停止，并在必要时转由人工处理。'] },
  { title: employeeDimensionDefinitions[3].question, options: ['检查内容是否满足当前任务要求，再根据需要调整。', '除任务要求外，还会检查前后是否一致，以及是否存在明显异常或不确定内容。', '除上述检查外，涉及关键事实、数据或引用时，会回到原始信息进行核对。', '在完成关键信息核对后，会根据内容的使用范围和可能影响决定检查深度，重要内容由人再次确认。', '这类工作已有固定检查清单，会按清单核验任务要求、异常和关键信息，并保留必要的来源或确认记录。'] },
  { title: employeeDimensionDefinitions[4].question, options: ['临时需要时单独使用一次，结果再由自己带回原来的工作中继续处理。', '通常只在其中一个固定步骤使用 AI，前后步骤仍按原来的方式完成。', '会在几个连续步骤中使用 AI，但步骤之间的信息整理和确认主要由自己完成。', '会把多个 AI 步骤与现有模板、资料库或工作工具组合起来，步骤顺序和处理方式已经相对固定。', '这类工作已有稳定流程，明确了输入、连续处理步骤、人工确认点和异常时的人工接手方式。'] },
  { title: employeeDimensionDefinitions[5].question, options: ['通常从头开始，根据当时的情况重新与 AI 沟通。', '会翻找以前的对话或结果，挑出有用的部分再次使用。', '会保存常用的任务说明、材料或结果示例，并根据新任务进行修改。', '已经整理出相对固定的步骤或模板，遇到同类任务时会按它处理。', '这套做法包含适用情况、需要调整的内容和检查点，自己或同事可以按说明复用。'] },
];

type EmployeeTaskDraft = Omit<EmployeeTaskDemandInput, 'occurrence' | 'stability' | 'audience'> & {
  occurrence: OccurrencePattern | '';
  stability: StepStability | '';
  audience: EmployeeAudience | '';
};

function emptyTask(): EmployeeTaskDraft {
  return { id: globalThis.crypto.randomUUID(), title: '', currentProcess: '', mainProblem: '', occurrence: '', stability: '', audience: '', aiUseStatus: 'never', expectedSupport: '' };
}

function toggle(values: string[], value: string, max?: number): string[] {
  if (values.includes(value)) return values.filter((item) => item !== value);
  return max && values.length >= max ? values : [...values, value];
}

function CheckboxGroup({ legend, options, values, onChange, max }: { legend: string; options: string[]; values: string[]; onChange: (values: string[]) => void; max?: number }) {
  return <fieldset className="employee-checklist"><legend>{legend}</legend>{options.map((option) => <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={() => onChange(toggle(values, option, max))} />{option}</label>)}</fieldset>;
}

export function EmployeeSurveyPage() {
  const client = useDataClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [step, setStep] = useState<Step>('ai-status');
  const [dimensionIndex, setDimensionIndex] = useState(0);
  const [profile, setProfile] = useState<UserProfileInput | null>(null);
  const [profileLoadState, setProfileLoadState] = useState<'loading' | 'ready' | 'incomplete' | 'failed'>('loading');
  const [aiUseStatus, setAiUseStatus] = useState<EmployeeAiUseStatus | null>(null);
  const [nonUseReasons, setNonUseReasons] = useState<string[]>([]);
  const [discontinuationReasons, setDiscontinuationReasons] = useState<string[]>([]);
  const [aiToolIds, setAiToolIds] = useState<string[]>([]);
  const [aiToolOther, setAiToolOther] = useState('');
  const [aiScenarios, setAiScenarios] = useState<string[]>([]);
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [hasExplicitDemand, setHasExplicitDemand] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<EmployeeTaskDemandInput[]>([]);
  const [draftTask, setDraftTask] = useState<EmployeeTaskDraft>(emptyTask());
  const [editingTaskIndex, setEditingTaskIndex] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<DimensionAnswer[]>([null, null, null, null, null, null]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editLoadState, setEditLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed' | 'blocked'>(editId ? 'loading' : 'idle');
  const [loadedEditId, setLoadedEditId] = useState<string | null>(null);
  const [loadedEditBatchId, setLoadedEditBatchId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([client.getReferenceData(), client.getProfile()]).then(([nextReferenceData, nextProfile]) => {
      if (!active) return;
      setReferenceData(nextReferenceData);
      setProfile(nextProfile);
      setProfileLoadState(isCompleteUserProfile(nextProfile) ? 'ready' : 'incomplete');
    }).catch(() => {
      if (!active) return;
      setProfileLoadState('failed');
      setError('暂时无法读取问卷参考信息，请稍后重试。');
    });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (!editId || !referenceData) return;
    let active = true;
    setEditLoadState('loading');
    setLoadedEditId(null);
    setLoadedEditBatchId(null);
    void client.getEmployeeResponse(editId).then((record) => {
      if (!active) return;
      if (!record) { setEditLoadState('failed'); return; }
      if (record.batchId !== referenceData.activeBatch.id) {
        setLoadedEditBatchId(record.batchId);
        setEditLoadState('blocked');
        return;
      }
      const input = record.input;
      setAiUseStatus(input.aiUseStatus);
      setNonUseReasons(input.nonUseReasons);
      setDiscontinuationReasons(input.discontinuationReasons);
      setAiToolIds(input.aiToolIds);
      setAiToolOther(input.aiToolOther ?? '');
      setAiScenarios(input.aiScenarios);
      setPainPoints(input.painPoints);
      setHasExplicitDemand(input.hasExplicitDemand);
      setTasks(input.tasks.map((task) => ({ ...task, id: task.id ?? globalThis.crypto.randomUUID() })));
      setDimensions([...input.dimensions]);
      setDraftTask(emptyTask());
      setEditingTaskIndex(null);
      setStep('ai-status');
      setDimensionIndex(0);
      setError(null);
      setLoadedEditId(editId);
      setLoadedEditBatchId(record.batchId);
      setEditLoadState('ready');
    }).catch(() => { if (active) { setLoadedEditId(null); setLoadedEditBatchId(null); setEditLoadState('failed'); } });
    return () => { active = false; };
  }, [client, editId, referenceData]);

  const progress = useMemo(() => `${steps.indexOf(step) + 1} / ${steps.length}`, [step]);
  const isNever = aiUseStatus === 'never';
  const currentDimension = dimensionQuestions[dimensionIndex];

  function nextStep(): void { setError(null); setStep(steps[steps.indexOf(step) + 1] ?? step); }
  function previousStep(): void { setError(null); setStep(steps[steps.indexOf(step) - 1] ?? step); }
  function taskValid(task: EmployeeTaskDraft): boolean { return Boolean(task.title.trim() && task.currentProcess.trim() && task.mainProblem.trim() && task.expectedSupport.trim() && task.occurrence && task.stability && task.audience && (task.aiUseStatus === 'never' || task.aiFollowUp?.trim())); }

  function addTask(): void {
    if (!taskValid(draftTask)) { setError('请完成这项任务的必填内容后再保存任务。'); return; }
    const task: EmployeeTaskDemandInput = {
      ...draftTask,
      occurrence: draftTask.occurrence as OccurrencePattern,
      stability: draftTask.stability as StepStability,
      audience: draftTask.audience as EmployeeAudience,
    };
    setTasks((items) => editingTaskIndex === null ? [...items, task] : items.map((item, index) => index === editingTaskIndex ? task : item));
    setDraftTask(emptyTask()); setEditingTaskIndex(null); setError(null);
  }

  async function save(): Promise<void> {
    if (!referenceData || !aiUseStatus || !isCompleteUserProfile(profile)) return;
    if (editId && loadedEditBatchId !== referenceData.activeBatch.id) {
      setError('这份答卷不属于当前调研批次，不能修改或保存到当前批次。');
      return;
    }
    const finalDimensions: EmployeeSurveyInput['dimensions'] = isNever
      ? [dimensions[0], null, null, null, null, null]
      : [dimensions[0], dimensions[1], dimensions[2], dimensions[3], dimensions[4], dimensions[5]];
    if (finalDimensions.some((item, index) => item === null && (!isNever || index === 0))) { setError('请完成行为回顾后再保存。'); return; }
    setIsSaving(true); setError(null);
    try {
      const normalizedTasks = tasks.map((task) => isNever ? { ...task, aiUseStatus: 'never' as const, aiFollowUp: undefined } : task);
      const saved = await client.saveEmployeeSurvey({ batchId: referenceData.activeBatch.id, surveyVersionId: referenceData.activeBatch.employeeSurveyVersionId, profile, aiUseStatus, nonUseReasons: isNever ? nonUseReasons : [], discontinuationReasons: aiUseStatus === 'tried_rarely' ? discontinuationReasons : [], aiToolIds: isNever ? [] : aiToolIds, aiToolOther: !isNever && aiToolIds.includes('other') ? aiToolOther.trim() : undefined, aiScenarios: isNever ? [] : aiScenarios, painPoints, hasExplicitDemand: hasExplicitDemand === true, tasks: hasExplicitDemand ? normalizedTasks : [], dimensions: finalDimensions });
      navigate(`/survey/responses/employee/${saved.id}`);
    } catch { setError('保存没有完成，已保留当前页面内容，请稍后重试。'); setIsSaving(false); }
  }

  if (profileLoadState === 'loading') return <StepLayout module="员工需求调研" progress="准备中" title="正在准备问卷"><PageState title="正在读取基本资料" description="请稍候，不会丢失已填写的内容。" /></StepLayout>;
  if (profileLoadState === 'incomplete') return <StepLayout module="员工需求调研" progress="需要补充资料" title="请先补充基本资料"><PageState title="完成基本资料后即可开始员工需求调研" description="基本资料会作为本次答卷的背景快照保存。" tone="warning" action={<Link to="/survey/profile?returnTo=%2Fsurvey%2Femployee">补充基本资料</Link>} /></StepLayout>;
  if (profileLoadState === 'failed') return <StepLayout module="员工需求调研" progress="无法载入" title="暂时无法读取基本资料"><PageState title={error ?? '请稍后重试'} tone="danger" /></StepLayout>;
  if (!referenceData) return <StepLayout module="员工需求调研" progress="准备中" title="正在准备问卷"><PageState title={error ?? '正在读取参考信息'} description="请稍候，不会丢失已填写的内容。" tone={error ? 'danger' : 'neutral'} /></StepLayout>;
  if (editId && editLoadState === 'failed') return <StepLayout module="员工需求调研" progress="无法载入" title="暂时无法载入原答卷"><PageState title="未找到可修改的员工答卷" description="请返回个人复盘后重试；不会创建或覆盖任何答卷。" tone="danger" /></StepLayout>;
  if (editId && editLoadState === 'blocked') return <StepLayout module="员工需求调研" progress="历史答卷" title="历史批次答卷无法修改"><PageState title="这份答卷不属于当前调研批次" description="为避免内容误写入当前批次，历史答卷不能修改或重新保存。请返回个人复盘查看原答卷。" tone="warning" /></StepLayout>;
  if (editId && (editLoadState === 'loading' || loadedEditId !== editId)) return <StepLayout module="员工需求调研" progress="正在载入" title="正在载入原答卷"><PageState title="正在读取原始回答" description="请稍候，载入完成后可以继续修改。" /></StepLayout>;
  const actions = <div className="employee-actions">{step !== 'ai-status' && <TextAction direction="back" onClick={previousStep}>上一题</TextAction>}{error && <p className="employee-error" role="alert">{error}</p>}</div>;
  if (step === 'ai-status') return <StepLayout module="员工需求调研" progress={progress} title="您目前在工作中使用 AI 的情况是？" description="这仅用于理解使用背景，不参与评分。" actions={<>{actions}<TextAction onClick={() => aiUseStatus ? nextStep() : setError('请选择一项当前使用情况。')}>下一题</TextAction></>}><OptionList name="ai-status" options={aiStatusOptions} value={aiUseStatus ?? undefined} onChange={(value) => { const nextStatus = value as EmployeeAiUseStatus; setAiUseStatus(nextStatus); if (nextStatus === 'never') setTasks((items) => items.map((task) => ({ ...task, aiUseStatus: 'never', aiFollowUp: undefined }))); setError(null); }} /></StepLayout>;
  if (step === 'ai-detail') {
    if (isNever) return <StepLayout module="员工需求调研" progress={progress} title="您还没有使用 AI 的主要原因是？" description="可选择多个。" actions={<>{actions}<TextAction onClick={() => nonUseReasons.length ? nextStep() : setError('请至少选择一个原因。')}>下一题</TextAction></>}><CheckboxGroup legend="未使用原因" options={nonUseReasonOptions} values={nonUseReasons} onChange={setNonUseReasons} /></StepLayout>;
    return <StepLayout module="员工需求调研" progress={progress} title="您使用过哪些工具和场景？" description="工具至少选择一项；主要场景最多选择三项。" actions={<>{actions}<TextAction onClick={() => { if (!aiToolIds.length || !aiScenarios.length) { setError('请选择至少一个工具和一个使用场景。'); return; } if (aiToolIds.includes('other') && !aiToolOther.trim()) { setError('请选择“其他”后，请补充工具名称。'); return; } if (aiUseStatus === 'tried_rarely' && !discontinuationReasons.length) { setError('请至少选择一个很少继续使用的原因。'); return; } nextStep(); }}>下一题</TextAction></>}><CheckboxGroup legend="使用过的 AI 工具" options={referenceData.aiTools.map((item) => item.label)} values={aiToolIds.map((id) => referenceData.aiTools.find((item) => item.id === id)?.label ?? id)} onChange={(labels) => setAiToolIds(labels.map((label) => referenceData.aiTools.find((item) => item.label === label)?.id ?? label))} />{aiToolIds.includes('other') && <label className="employee-field">其他工具名称<input value={aiToolOther} onChange={(event) => setAiToolOther(event.target.value)} /></label>}{aiUseStatus === 'tried_rarely' && <CheckboxGroup legend="很少继续使用的原因" options={discontinuationReasonOptions} values={discontinuationReasons} onChange={setDiscontinuationReasons} />}<CheckboxGroup legend="主要使用场景（最多三项）" options={scenarioOptions} values={aiScenarios} onChange={setAiScenarios} max={3} /></StepLayout>;
  }
  if (step === 'pain-points') return <StepLayout module="员工需求调研" progress={progress} title="哪些情况最容易让工作变得困难？" description="选填，最多三项。这些提示只帮助您回忆工作，不会直接生成需求。" actions={<>{actions}<TextAction onClick={nextStep}>下一题</TextAction></>}><CheckboxGroup legend="工作痛点提示" options={painPointOptions} values={painPoints} onChange={setPainPoints} max={3} /></StepLayout>;
  if (step === 'demand') return <StepLayout module="员工需求调研" progress={progress} title="您现在有想改善的具体工作吗？" description="暂时没有明确需求也可以正常完成本次问卷。" actions={<>{actions}<TextAction onClick={() => { if (hasExplicitDemand === null) { setError('请选择一项。'); return; } setStep(hasExplicitDemand ? 'tasks' : 'dimensions'); }}>下一题</TextAction></>}><OptionList name="has-demand" options={[{ value: 'yes', label: '我有想改善的工作', description: '接下来可记录 1–3 项真实任务。' }, { value: 'no', label: '暂时没有明确想改善的工作', description: '跳过任务卡，继续填写行为回顾。' }]} value={hasExplicitDemand === null ? undefined : hasExplicitDemand ? 'yes' : 'no'} onChange={(value) => setHasExplicitDemand(value === 'yes')} /></StepLayout>;
  if (step === 'tasks') {
    if (!hasExplicitDemand) return <StepLayout module="员工需求调研" progress={progress} title="暂时没有明确想改善的工作" description="您可以继续填写行为回顾，或返回修改刚才的选择。" actions={<div className="employee-actions"><TextAction direction="back" onClick={() => setStep('demand')}>上一题</TextAction><TextAction onClick={() => setStep('dimensions')}>继续填写</TextAction></div>} />;
    return <StepLayout module="员工需求调研" progress={progress} title={tasks.length ? '补充或确认真实任务' : '描述一项最希望改善的具体工作'} description="一次只写一项真实工作。最多三项；保存后可在当前页编辑或删除。" actions={<>{actions}<TextAction onClick={() => tasks.length ? nextStep() : setError('请至少保存一项真实任务，或返回上一步选择暂时没有明确需求。')}>下一题</TextAction></>}><div className="employee-task-list">{tasks.map((task, index) => <article key={task.id ?? `${task.title}-${index}`}><strong>{index === 0 ? '最希望改善' : `补充任务 ${index + 1}`}</strong><p>{task.title}</p><div><button type="button" onClick={() => { setDraftTask(task); setEditingTaskIndex(index); setError(null); }}>编辑</button><button type="button" onClick={() => { setTasks((items) => items.filter((_, itemIndex) => itemIndex !== index)); if (editingTaskIndex === index) { setEditingTaskIndex(null); setDraftTask(emptyTask()); } else if (editingTaskIndex !== null && editingTaskIndex > index) setEditingTaskIndex(editingTaskIndex - 1); }}>删除</button></div></article>)}</div>{(tasks.length < 3 || editingTaskIndex !== null) && <TaskEditor task={draftTask} forceNever={isNever} onChange={setDraftTask} onSave={addTask} saveLabel={editingTaskIndex === null ? '保存这项任务' : '保存修改'} />}</StepLayout>;
  }
  const dimensionNumber = dimensionIndex + 1;
  return <StepLayout module="员工需求调研" progress={`行为回顾 ${dimensionNumber} / ${isNever ? 1 : 6}`} title={currentDimension.title} description={dimensionIndex === 0 ? '请选择最接近您实际做法的描述。' : '请回想最近一次符合题意的真实工作。'} actions={<div className="employee-actions"><TextAction direction="back" onClick={() => dimensionIndex > 0 ? setDimensionIndex((index) => index - 1) : setStep(hasExplicitDemand ? 'tasks' : 'demand')}>上一题</TextAction>{error && <p className="employee-error" role="alert">{error}</p>}<TextAction disabled={isSaving} onClick={() => { if (dimensions[dimensionIndex] === null) { setError('请选择一项描述。'); return; } if (isNever || dimensionIndex === 5) { void save(); } else { setDimensionIndex((index) => index + 1); setError(null); } }}>{isSaving ? '正在保存…' : isNever || dimensionIndex === 5 ? '保存答卷' : '下一题'}</TextAction></div>}><OptionList name={`dimension-${dimensionIndex}`} options={currentDimension.options.map((label, index) => ({ value: String(index + 1), label }))} value={dimensions[dimensionIndex]?.toString()} onChange={(value) => setDimensions((items) => items.map((item, index) => index === dimensionIndex ? Number(value) as DimensionAnswer : item))} /></StepLayout>;
}

function TaskEditor({ task, forceNever, onChange, onSave, saveLabel }: { task: EmployeeTaskDraft; forceNever: boolean; onChange: (task: EmployeeTaskDraft) => void; onSave: () => void; saveLabel: string }) {
  const set = <K extends keyof EmployeeTaskDraft>(key: K, value: EmployeeTaskDraft[K]) => onChange({ ...task, [key]: value });
  return <div className="employee-task-editor"><label>具体工作<textarea value={task.title} onChange={(event) => set('title', event.target.value)} placeholder="说明在什么情况下完成什么工作" /></label><label>目前怎么完成<textarea value={task.currentProcess} onChange={(event) => set('currentProcess', event.target.value)} placeholder="简述主要步骤、工具和必要协作" /></label><label>最需要改善的地方<textarea value={task.mainProblem} onChange={(event) => set('mainProblem', event.target.value)} /></label><div className="employee-form-grid"><label>发生规律<select value={task.occurrence} onChange={(event) => set('occurrence', event.target.value as EmployeeTaskDraft['occurrence'])}><option value="">请选择</option><option value="daily">几乎每天</option><option value="weekly">每周都会</option><option value="monthly_stage">每月或阶段性</option><option value="project_event">按项目或特定事件</option><option value="irregular">没有固定规律</option><option value="unknown">不确定</option></select></label><label>步骤稳定程度<select value={task.stability} onChange={(event) => set('stability', event.target.value as EmployeeTaskDraft['stability'])}><option value="">请选择</option><option value="fixed">基本固定</option><option value="partly_fixed">部分固定</option><option value="variable">变化较大</option><option value="unknown">不确定</option></select></label><label>共同使用或覆盖人群<select value={task.audience} onChange={(event) => set('audience', event.target.value as EmployeeTaskDraft['audience'])}><option value="">请选择</option><option value="self">主要是我自己</option><option value="same_position">同岗位还有其他人</option><option value="cross_function">涉及多个岗位或部门</option><option value="unknown">不确定</option></select></label></div>{!forceNever && <><label>这项工作中使用 AI 的情况<select value={task.aiUseStatus} onChange={(event) => set('aiUseStatus', event.target.value as EmployeeTaskDemandInput['aiUseStatus'])}><option value="using">正在使用</option><option value="stopped">尝试过但现在没有使用</option><option value="never">还没有使用过</option></select></label>{task.aiUseStatus !== 'never' && <label>{task.aiUseStatus === 'using' ? '目前怎么使用 AI？使用后还存在哪些问题？' : '当时怎么尝试的？为什么没有继续使用？'}<textarea value={task.aiFollowUp ?? ''} onChange={(event) => set('aiFollowUp', event.target.value)} /></label>}</>}<label>希望 AI 提供什么帮助？<textarea value={task.expectedSupport} onChange={(event) => set('expectedSupport', event.target.value)} placeholder="写希望 AI 做什么或达到什么效果，不要求技术方案" /></label><TextAction onClick={onSave}>{saveLabel}</TextAction></div>;
}
