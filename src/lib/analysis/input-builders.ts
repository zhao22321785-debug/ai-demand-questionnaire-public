import type {
  EmployeeAnalysisInput,
  PositionAnalysisInput,
} from '../../types/analysis';
import type {
  EmployeeResponseRecord,
  PositionResponseRecord,
  ReferenceData,
} from '../../types/survey';

function optionLabel(
  options: ReferenceData['departments'] | ReferenceData['positions'],
  id?: string,
  other?: string,
): string {
  return other || options.find((item) => item.id === id)?.label || id || '未说明';
}

export function buildEmployeeAnalysisInput(
  record: EmployeeResponseRecord,
  reference: ReferenceData,
): EmployeeAnalysisInput {
  const tasks = record.input.tasks.map((task, index) => ({
    ...task,
    id: task.id || `employee-task-${index + 1}`,
  }));
  return {
    subjectType: 'employee_assessment',
    subjectId: record.id,
    revision: record.revision,
    respondent: {
      department: optionLabel(reference.departments, record.input.profile.departmentId, record.input.profile.departmentOther),
      position: optionLabel(reference.positions, record.input.profile.positionId, record.input.profile.positionOther),
      experience: record.input.profile.currentPositionExperience,
    },
    aiUseStatus: record.input.aiUseStatus,
    aiUseBackground: [
      ...record.input.nonUseReasons,
      ...record.input.discontinuationReasons,
      ...record.input.aiScenarios,
      ...record.input.painPoints,
    ],
    backgroundEvidence: {
      nonUseReasons: record.input.nonUseReasons,
      discontinuationReasons: record.input.discontinuationReasons,
      aiScenarios: record.input.aiScenarios,
      painPoints: record.input.painPoints,
    },
    hasExplicitDemand: record.input.hasExplicitDemand,
    tasks,
    dimensions: record.input.dimensions,
    allowedEvidencePaths: [
      'aiUseStatus',
      'nonUseReasons',
      'discontinuationReasons',
      'aiScenarios',
      'painPoints',
      ...tasks.flatMap((task) => [
        `tasks.${task.id}.title`,
        `tasks.${task.id}.currentProcess`,
        `tasks.${task.id}.mainProblem`,
        `tasks.${task.id}.occurrence`,
        `tasks.${task.id}.stability`,
        `tasks.${task.id}.audience`,
        `tasks.${task.id}.expectedSupport`,
      ]),
      ...record.input.dimensions.map((_, index) => `dimensions.${index}`),
    ],
  };
}

export function buildPositionAnalysisInput(
  record: PositionResponseRecord,
  reference: ReferenceData,
): PositionAnalysisInput {
  const tasks = record.input.taskDemands.map((task, index) => {
    const {
      requiresCollaboration: _requiresCollaboration,
      collaborationDepartments,
      collaborationPositions,
      handoffContent,
      collaborationProblem,
      collaborationAiSupport,
      ...analysisTask
    } = task;
    return {
      ...analysisTask,
      id: task.id || `position-task-${index + 1}`,
      collaboration: [
        ...collaborationDepartments,
        ...collaborationPositions,
        handoffContent,
        collaborationProblem,
        collaborationAiSupport,
      ].filter((value): value is string => Boolean(value)),
    };
  });
  return {
    subjectType: 'position_survey',
    subjectId: record.id,
    revision: record.revision,
    position: {
      department: optionLabel(reference.departments, record.input.departmentId, record.input.departmentOther),
      name: record.input.positionName,
      experience: record.input.relatedPositionExperience,
    },
    workItems: record.input.workItems,
    tasks,
    allowedEvidencePaths: [
      ...record.input.workItems.flatMap((item) => [
        `workItems.${item.id}.name`,
        `workItems.${item.id}.description`,
      ]),
      ...tasks.flatMap((task) => [
        `tasks.${task.id}.task`,
        `tasks.${task.id}.commonInput`,
        `tasks.${task.id}.output`,
        `tasks.${task.id}.currentProcess`,
        `tasks.${task.id}.mainProblem`,
        `tasks.${task.id}.occurrence`,
        `tasks.${task.id}.stability`,
        `tasks.${task.id}.audience`,
        `tasks.${task.id}.expectedAiSupport`,
        `tasks.${task.id}.humanReviewContent`,
        `tasks.${task.id}.collaboration`,
      ]),
    ],
  };
}
