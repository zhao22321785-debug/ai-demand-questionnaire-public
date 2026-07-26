import type {
  EvidenceComparisonRelation,
  EvidenceDimensionComparison,
} from '../../types/analysis';

type ScenarioSource = {
  subjectType: 'employee_assessment' | 'position_survey';
  subjectId: string;
};

function uniqueValidIds(ids: string[], allowed: Set<string>): string[] {
  return [...new Set(ids)].filter((id) => allowed.has(id));
}

function relationForCoverage(
  requested: EvidenceComparisonRelation,
  employeeCount: number,
  positionCount: number,
  totalSources: number,
  minSampleSize: number,
): EvidenceComparisonRelation {
  if (totalSources < minSampleSize) return 'insufficient_sample';
  if (employeeCount === 0 && positionCount === 0) return 'both_missing';
  if (employeeCount === 0) return 'employee_missing';
  if (positionCount === 0) return 'position_missing';
  if (requested === 'employee_missing' || requested === 'position_missing' || requested === 'both_missing' || requested === 'insufficient_sample') {
    return 'both_mentioned';
  }
  return requested;
}

export function sanitizeEvidenceDimensions(
  dimensions: EvidenceDimensionComparison[] | undefined,
  sources: ScenarioSource[],
  minSampleSize: number,
): EvidenceDimensionComparison[] {
  if (!dimensions?.length) return [];
  const employeeSources = new Set(
    sources.filter((source) => source.subjectType === 'employee_assessment').map((source) => source.subjectId),
  );
  const positionSources = new Set(
    sources.filter((source) => source.subjectType === 'position_survey').map((source) => source.subjectId),
  );

  return dimensions.map((dimension) => {
    const employeeSourceIds = uniqueValidIds(dimension.employeeSourceIds, employeeSources);
    const positionSourceIds = uniqueValidIds(dimension.positionSourceIds, positionSources);
    return {
      ...dimension,
      employeeSourceIds,
      positionSourceIds,
      employeeSourceCount: employeeSourceIds.length,
      employeeSourceTotal: employeeSources.size,
      positionSourceCount: positionSourceIds.length,
      positionSourceTotal: positionSources.size,
      employeeSummary: employeeSourceIds.length ? dimension.employeeSummary : '',
      positionSummary: positionSourceIds.length ? dimension.positionSummary : '',
      relation: relationForCoverage(
        dimension.relation,
        employeeSourceIds.length,
        positionSourceIds.length,
        employeeSources.size + positionSources.size,
        minSampleSize,
      ),
    };
  });
}
