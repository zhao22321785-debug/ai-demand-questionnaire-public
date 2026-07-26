export type SystemRole = 'user' | 'admin';
export type SurveyIdentity = 'employee' | 'position_researcher';
export type AnalysisStatus = 'pending' | 'running' | 'complete' | 'failed' | 'stale';
export type ExperienceRange = 'under_1' | '1_3' | '3_5' | '5_10' | 'over_10';
export type OccurrencePattern =
  | 'daily'
  | 'weekly'
  | 'monthly_stage'
  | 'project_event'
  | 'irregular'
  | 'unknown';
export type StepStability = 'fixed' | 'partly_fixed' | 'variable' | 'unknown';

export interface OptionItem {
  id: string;
  code: string;
  label: string;
  enabled?: boolean;
}

export interface ReferenceData {
  activeBatch: {
    id: string;
    name: string;
    surveyVersionId: string;
    employeeSurveyVersionId: string;
    positionSurveyVersionId: string;
  };
  departments: OptionItem[];
  positions: OptionItem[];
  aiTools: OptionItem[];
}

export interface UserProfileInput {
  name: string;
  departmentId?: string;
  departmentOther?: string;
  positionId?: string;
  positionOther?: string;
  currentPositionExperience: ExperienceRange;
}

export type EmployeeAiUseStatus = 'frequent' | 'sometimes' | 'tried_rarely' | 'never';
export type TaskAiUseStatus = 'using' | 'stopped' | 'never';
export type EmployeeAudience = 'self' | 'same_position' | 'cross_function' | 'unknown';
export type DimensionAnswer = 1 | 2 | 3 | 4 | 5 | null;

export interface EmployeeTaskDemandInput {
  id?: string;
  title: string;
  currentProcess: string;
  mainProblem: string;
  occurrence: OccurrencePattern;
  stability: StepStability;
  audience: EmployeeAudience;
  aiUseStatus: TaskAiUseStatus;
  aiFollowUp?: string;
  expectedSupport: string;
}

export interface EmployeeSurveyInput {
  batchId: string;
  surveyVersionId: string;
  profile: UserProfileInput;
  aiUseStatus: EmployeeAiUseStatus;
  nonUseReasons: string[];
  discontinuationReasons: string[];
  aiToolIds: string[];
  aiToolOther?: string;
  aiScenarios: string[];
  painPoints: string[];
  hasExplicitDemand: boolean;
  tasks: EmployeeTaskDemandInput[];
  dimensions: [
    DimensionAnswer,
    DimensionAnswer,
    DimensionAnswer,
    DimensionAnswer,
    DimensionAnswer,
    DimensionAnswer,
  ];
}

export type PositionAudience = 'single' | 'same_position' | 'cross_function' | 'unknown';
export type AiParticipation = 'reference' | 'assist' | 'partial_automation' | 'mostly_automated' | 'unknown';
export type ResultUsage = 'direct' | 'human_review' | 'reference_only' | 'unknown';

export interface PositionWorkItemInput {
  id: string;
  name: string;
  description: string;
  selectedForImprovement: boolean;
}

export interface PositionTaskDemandInput {
  id?: string;
  workItemId: string;
  task: string;
  commonInput: string;
  hasFixedInput: boolean;
  output: string;
  hasFixedOutput: boolean;
  currentProcess: string;
  mainProblem: string;
  occurrence: OccurrencePattern;
  stability: StepStability;
  audience: PositionAudience;
  aiParticipation: AiParticipation;
  expectedAiSupport: string;
  resultUsage: ResultUsage;
  humanReviewContent?: string;
  requiresCollaboration: boolean;
  collaborationDepartments: string[];
  collaborationPositions: string[];
  handoffContent?: string;
  collaborationProblem?: string;
  collaborationAiSupport?: string;
}

export interface PositionSurveyInput {
  batchId: string;
  surveyVersionId: string;
  researcherName: string;
  departmentId?: string;
  departmentOther?: string;
  positionId?: string;
  positionOther?: string;
  positionName: string;
  relatedPositionExperience: ExperienceRange;
  workItems: PositionWorkItemInput[];
  taskDemands: PositionTaskDemandInput[];
}

export interface SavedResponse {
  id: string;
  revision: number;
  analysisStatus: AnalysisStatus;
}

export interface ResponseBase {
  id: string;
  userId: string;
  batchId: string;
  revision: number;
  analysisStatus: AnalysisStatus;
  submittedAt: string;
  updatedAt: string;
}

export type EmployeeResponseRecord = ResponseBase & { type: 'employee'; input: EmployeeSurveyInput };
export type PositionResponseRecord = ResponseBase & { type: 'position'; positionKey: string; input: PositionSurveyInput };
export type SurveyResponseRecord = EmployeeResponseRecord | PositionResponseRecord;

export interface ResponseSummary {
  id: string;
  type: 'employee' | 'position';
  title: string;
  subtitle: string;
  revision: number;
  analysisStatus: AnalysisStatus;
  submittedAt: string;
}

export interface AdminResponseFilters {
  query?: string;
  departmentId?: string;
  positionId?: string;
  experience?: ExperienceRange;
  analysisStatus?: AnalysisStatus;
}
