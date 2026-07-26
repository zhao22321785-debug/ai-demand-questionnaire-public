import type {
  AdminResponseFilters,
  EmployeeResponseRecord,
  EmployeeSurveyInput,
  PositionResponseRecord,
  PositionSurveyInput,
  ReferenceData,
  ResponseSummary,
  SavedResponse,
  UserProfileInput,
} from '../../types/survey';
import type {
  AdminDashboardDto,
  AnalysisRecord,
  AnalysisRequest,
  SubjectType,
} from '../../types/analysis';

export interface AdminResponseListFilters extends AdminResponseFilters {
  batchId?: string;
}

export interface AnalysisRetryAccepted {
  accepted: true;
}

export interface SurveyDataClient {
  getReferenceData(): Promise<ReferenceData>;
  getProfile(): Promise<UserProfileInput | null>;
  saveProfile(profile: UserProfileInput): Promise<UserProfileInput>;
  saveEmployeeSurvey(input: EmployeeSurveyInput): Promise<SavedResponse>;
  savePositionSurvey(input: PositionSurveyInput): Promise<SavedResponse>;
  listMyResponses(): Promise<ResponseSummary[]>;
  getEmployeeResponse(id: string): Promise<EmployeeResponseRecord | null>;
  getPositionResponse(id: string): Promise<PositionResponseRecord | null>;
  listEmployeeResponses(filters?: AdminResponseListFilters): Promise<EmployeeResponseRecord[]>;
  listPositionResponses(filters?: AdminResponseListFilters): Promise<PositionResponseRecord[]>;
  getAnalysis(subjectType: SubjectType, subjectId: string): Promise<AnalysisRecord | null>;
  requestAnalysis(request: AnalysisRequest): Promise<{ accepted: boolean }>;
  retryAnalysis(request: AnalysisRequest): Promise<AnalysisRetryAccepted>;
  getAdminDashboard(): Promise<AdminDashboardDto>;
}
