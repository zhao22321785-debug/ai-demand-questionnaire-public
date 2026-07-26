import type {
  AggregateScenario,
  EmployeeAnalysisResult,
  EvidenceComparisonStatus,
  PositionAnalysisResult,
  ScenarioAnalysis,
  SingleAnalysisResult,
} from '../../types/analysis';

export type ScenarioCandidate = {
  result: SingleAnalysisResult;
  scenario: SingleAnalysisResult['scenarios'][number];
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

const taskTerms = [
  '访谈', '用户研究', '调研', '故障', '排障', '日志', '提交', '接口', '调用方', '交接', '工单', '发布',
  '测试', '用例', '回归', '缺陷', '失败', '质量', '文档', '审阅', '合同', '会议', '客户', '销售', '报表',
  '数据', '翻译', '知识库', '代码', '审批', '招聘', '培训',
] as const;
const strongTaskTerms = new Set([
  '访谈', '用户研究', '故障', '排障', '接口', '调用方', '交接', '工单', '发布',
  '用例', '回归', '缺陷', '失败', '合同', '会议', '报表', '翻译', '知识库', '审批', '招聘', '培训',
]);

function scenarioText(scenario: ScenarioAnalysis): string {
  return [
    scenario.title,
    scenario.taskSummary,
    scenario.currentProcess,
    scenario.mainProblem,
    scenario.commonInput || '',
    scenario.expectedOutput || '',
  ].map(normalized).join(' ');
}

function sharedTaskTerms(left: string, right: string): string[] {
  return taskTerms.filter((term) => left.includes(term) && right.includes(term));
}

function bigrams(value: string): Set<string> {
  const compact = normalized(value).replace(/[^\p{L}\p{N}]+/gu, '');
  if (compact.length < 2) return new Set(compact ? [compact] : []);
  return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)));
}

function overlapRatio(left: string, right: string): number {
  const leftTokens = bigrams(left);
  const rightTokens = bigrams(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function compatibleField(left?: string, right?: string): boolean {
  if (!left?.trim() || !right?.trim()) return true;
  const normalizedLeft = normalized(left);
  const normalizedRight = normalized(right);
  if (normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return true;
  if (sharedTaskTerms(normalizedLeft, normalizedRight).length > 0) return true;
  return overlapRatio(normalizedLeft, normalizedRight) >= 0.35;
}

function positionsOverlap(left: string[], right: string[]): boolean {
  if (!left.length || !right.length) return true;
  return left.some((leftPosition) => right.some((rightPosition) => {
    const a = normalized(leftPosition);
    const b = normalized(rightPosition);
    return a === b || a.includes(b) || b.includes(a);
  }));
}

function explicitBusinessConflict(left: ScenarioCandidate, right: ScenarioCandidate): boolean {
  if (!positionsOverlap(left.result.positions, right.result.positions)) return true;
  if (left.scenario.commonInput?.trim() && right.scenario.commonInput?.trim()
    && !compatibleField(left.scenario.commonInput, right.scenario.commonInput)) return true;
  if (left.scenario.expectedOutput?.trim() && right.scenario.expectedOutput?.trim()
    && !compatibleField(left.scenario.expectedOutput, right.scenario.expectedOutput)) return true;
  return false;
}

export function areScenarioCandidatesCompatible(left: ScenarioCandidate, right: ScenarioCandidate): boolean {
  if (!positionsOverlap(left.result.positions, right.result.positions)) return false;
  if (!left.result.positions.length && !right.result.positions.length && normalized(left.scenario.audience) !== normalized(right.scenario.audience)) return false;
  if (!compatibleField(left.scenario.commonInput, right.scenario.commonInput)) return false;
  if (!compatibleField(left.scenario.expectedOutput, right.scenario.expectedOutput)) return false;

  const leftText = scenarioText(left.scenario);
  const rightText = scenarioText(right.scenario);
  const sharedTerms = sharedTaskTerms(leftText, rightText);
  const hasStrongSharedTerm = sharedTerms.some((term) => strongTaskTerms.has(term));
  const sameTaskName = normalized(left.scenario.title) === normalized(right.scenario.title)
    || normalized(left.scenario.taskSummary) === normalized(right.scenario.taskSummary);
  return hasStrongSharedTerm || sharedTerms.length >= 2 || sameTaskName || overlapRatio(left.scenario.title, right.scenario.title) >= 0.45;
}

export function groupScenarioDetails(candidates: ScenarioCandidate[]): ScenarioCandidate[][] {
  const groups: ScenarioCandidate[][] = [];
  for (const candidate of candidates) {
    const matchingIndexes = groups.flatMap((group, index) => (
      group.some((member) => areScenarioCandidatesCompatible(candidate, member))
      && group.every((member) => !explicitBusinessConflict(candidate, member))
        ? [index]
        : []
    ));
    if (!matchingIndexes.length) {
      groups.push([candidate]);
      continue;
    }
    const targetIndex = matchingIndexes[0];
    groups[targetIndex].push(candidate);
    for (const mergeIndex of matchingIndexes.slice(1).reverse()) {
      const canMerge = groups[targetIndex].every((left) => groups[mergeIndex].every((right) => !explicitBusinessConflict(left, right)));
      if (!canMerge) continue;
      groups[targetIndex].push(...groups[mergeIndex]);
      groups.splice(mergeIndex, 1);
    }
  }
  return groups;
}

export function groupScenarioCandidateDetails(analyses: SingleAnalysisResult[]): ScenarioCandidate[][] {
  return groupScenarioDetails(analyses.flatMap((result) => result.scenarios.map((scenario) => ({ result, scenario }))));
}

export function demandDirectionForScenarioGroup(group: ScenarioCandidate[]): string {
  const text = group.map((candidate) => scenarioText(candidate.scenario)).join(' ');
  if (/访谈|用户研究|调研/.test(text)) return '用户研究与洞察';
  if (/测试|用例|回归|缺陷|质量/.test(text)) return '测试与质量保障';
  if (/故障|排障|日志|接口|调用方|交接|工单|发布/.test(text)) return '研发交付与协作';
  if (/文档|审阅|合同|内容/.test(text)) return '文档与内容质量';
  if (/会议|沟通|客户|销售/.test(text)) return '沟通与客户工作';
  const representative = group.find((candidate) => candidate.result.kind === 'position') ?? group[0];
  return `${representative.scenario.title}相关工作`;
}

function representative(group: ScenarioCandidate[]): ScenarioCandidate {
  const positionCandidates = group.filter((candidate) => candidate.result.kind === 'position');
  const candidates = positionCandidates.length ? positionCandidates : group;
  return [...candidates].sort((left, right) => (
    right.scenario.title.length - left.scenario.title.length
    || normalized(left.scenario.title).localeCompare(normalized(right.scenario.title), 'zh-CN')
  ))[0];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function joined(values: string[]): string {
  return unique(values).join('；');
}

function themeId(title: string): string {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `theme-${hash.toString(36)}`;
}

export function compareEvidence(
  employeeCount: number,
  positionCount: number,
  explicitConflict = false,
): { status: EvidenceComparisonStatus } {
  if (explicitConflict && employeeCount > 0 && positionCount > 0) return { status: 'explicit_conflict' };
  if (employeeCount > 0 && positionCount > 0) return { status: 'both_supported' };
  if (employeeCount > 0) return { status: 'employee_only' };
  return { status: 'position_evidence_low' };
}

export function groupScenarioCandidates(analyses: SingleAnalysisResult[]): {
  scenarios: AggregateScenario[];
  capabilityThemes: { id: string; title: string; scenarioIds: string[] }[];
} {
  const groups = groupScenarioCandidateDetails(analyses);

  const scenarios = groups.map((group, index): AggregateScenario => {
    const first = representative(group);
    const employee = group.filter((item) => item.result.kind === 'employee') as Array<ScenarioCandidate & { result: EmployeeAnalysisResult }>;
    const position = group.filter((item) => item.result.kind === 'position') as Array<ScenarioCandidate & { result: PositionAnalysisResult }>;
    const sources = [...new Map(group.map(({ result, scenario }) => {
      const subjectType = result.kind === 'employee' ? 'employee_assessment' as const : 'position_survey' as const;
      const key = `${subjectType}:${result.subjectId}:${result.revision}`;
      return [key, {
      subjectType: result.kind === 'employee' ? 'employee_assessment' as const : 'position_survey' as const,
      subjectId: result.subjectId,
      revision: result.revision,
      title: scenario.title,
      route: result.kind === 'employee'
        ? `/admin/employee-responses/${encodeURIComponent(result.subjectId)}`
        : `/admin/position-responses/${encodeURIComponent(result.subjectId)}`,
      }] as const;
    })).values()];
    const completenessValues = group.map((item) => item.scenario.completeness);
    return {
      id: `scenario-${index + 1}-${themeId(first.scenario.title).slice(6)}`,
      title: first.scenario.title,
      capabilityTheme: demandDirectionForScenarioGroup(group),
      summary: first.scenario.taskSummary,
      currentProcess: joined(group.map((item) => item.scenario.currentProcess)),
      mainProblem: joined(group.map((item) => item.scenario.mainProblem)),
      occurrence: joined(group.map((item) => item.scenario.occurrence)),
      stability: joined(group.map((item) => item.scenario.stability)),
      audience: joined(group.map((item) => item.scenario.audience)),
      originalExpectations: unique(group.map((item) => item.scenario.originalExpectation)),
      possibleSupport: unique(group.flatMap((item) => item.scenario.supportForms)),
      departments: unique(group.flatMap((item) => item.result.departments)),
      positions: unique(group.flatMap((item) => item.result.positions)),
      responseCount: sources.length,
      coveredPeople: sources.length,
      employeeEvidence: employee.flatMap((item) => item.scenario.evidence),
      positionEvidence: position.flatMap((item) => item.scenario.evidence),
      evidenceStatus: compareEvidence(employee.length, position.length).status,
      completeness: completenessValues.every((value) => value === 'complete')
        ? 'complete'
        : completenessValues.some((value) => value !== 'insufficient') ? 'partial' : 'insufficient',
      followUpQuestions: unique(group.flatMap((item) => item.scenario.followUpQuestions)),
      sources,
    };
  });

  const themes = new Map<string, { id: string; title: string; scenarioIds: string[] }>();
  for (const scenario of scenarios) {
    const id = themeId(scenario.capabilityTheme);
    const current = themes.get(id) || { id, title: scenario.capabilityTheme, scenarioIds: [] };
    current.scenarioIds.push(scenario.id);
    themes.set(id, current);
  }
  return { scenarios, capabilityThemes: [...themes.values()] };
}
