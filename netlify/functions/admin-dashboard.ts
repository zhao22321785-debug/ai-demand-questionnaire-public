import { AggregateAnalysisResultSchema, type AdminDashboardDto, type AggregateAnalysisResult } from '../../src/types/analysis';
import {
  buildAiUsageStats,
  buildPositionDemandMatrix,
  type DashboardResponseFact,
} from '../../src/lib/analysis/dashboard';
import { employeeDimensionDefinitions } from '../../src/lib/survey/employee-dimensions';
import { authenticateRequest, requireAdmin } from './_shared/auth';
import { readAggregateSampleSize } from './_shared/env';
import { errorResponse, jsonResponse } from './_shared/http';
import { envValue, isProductionRuntime, type FunctionRuntimeContext } from './_shared/runtime-env';
import { createSupabaseAdminClient } from './_shared/supabase-admin';

function counts<T extends { label: string; count: number }>(items: T[]): T[] {
  return items.sort((a, b) => b.count - a.count);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

const aiUseStatusLabels: Record<string, string> = {
  frequent: '经常使用',
  sometimes: '有时使用',
  tried_rarely: '尝试过，但很少使用',
  never: '还没有使用过',
};

export function safeAggregateDashboardResult(status: unknown, payload: unknown): AggregateAnalysisResult | undefined {
  if (status !== 'complete') return undefined;
  const parsed = AggregateAnalysisResultSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

export default async function handler(request: Request, context?: FunctionRuntimeContext): Promise<Response> {
  try {
    const client = createSupabaseAdminClient();
    const actor = await authenticateRequest(request, client);
    requireAdmin(actor);
    const batch = await client.from('survey_batches').select('id,name').eq('status', 'active').order('created_at', { ascending: false }).limit(1).single();
    if (batch.error) throw new Error('读取当前批次失败', { cause: batch.error });
    const [stats, dimensions, departments, positions, aggregate, employeeResponses, positionResponses, aiTools] = await Promise.all([
      client.from('admin_response_statistics').select('*').eq('batch_id', batch.data.id),
      client.from('admin_dimension_statistics').select('*').eq('batch_id', batch.data.id).order('dimension_number'),
      client.from('departments').select('id,name'),
      client.from('positions').select('id,name'),
      client.from('aggregate_analysis_runs').select('*').eq('batch_id', batch.data.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      client.from('employee_assessments')
        .select('id,response_payload,ai_use_status,non_use_reasons,discontinuation_reasons,ai_tool_ids,ai_tool_other,ai_scenarios,pain_points')
        .eq('batch_id', batch.data.id),
      client.from('position_demand_surveys').select('id,position_id,position_other,position_name').eq('batch_id', batch.data.id),
      client.from('ai_tool_options').select('id,name'),
    ]);
    if (
      stats.error || dimensions.error || departments.error || positions.error || aggregate.error ||
      employeeResponses.error || positionResponses.error || aiTools.error
    ) throw new Error('读取管理看板数据失败');
    const departmentNames = new Map((departments.data ?? []).map((item) => [item.id, item.name]));
    const positionNames = new Map((positions.data ?? []).map((item) => [item.id, item.name]));
    const toolNames = new Map((aiTools.data ?? []).map((item) => [item.id, item.name]));
    const rows = stats.data ?? [];
    const total = rows.reduce((sum, row) => sum + Number(row.response_count), 0);
    const result = safeAggregateDashboardResult(aggregate.data?.status, aggregate.data?.result_payload);
    const departmentCoverage = new Map<string, number>();
    const analysisStatuses = new Map<string, number>();
    for (const row of rows) {
      const count = Number(row.response_count);
      const department = departmentNames.get(row.department_id) || '其他或未说明';
      departmentCoverage.set(department, (departmentCoverage.get(department) || 0) + count);
      analysisStatuses.set(row.analysis_status, (analysisStatuses.get(row.analysis_status) || 0) + count);
    }
    const responseFacts: DashboardResponseFact[] = [
      ...(employeeResponses.data ?? []).map((row): DashboardResponseFact => {
        const payload = record(row.response_payload);
        const profile = record(payload.profile);
        const positionId = typeof profile.positionId === 'string' ? profile.positionId : '';
        const positionOther = typeof profile.positionOther === 'string' ? profile.positionOther.trim() : '';
        const toolLabels = strings(row.ai_tool_ids).map((id) => toolNames.get(id) || '其他工具');
        const otherTool = typeof row.ai_tool_other === 'string' ? row.ai_tool_other.trim() : '';
        if (otherTool) toolLabels.push(otherTool);
        const status = typeof row.ai_use_status === 'string' ? row.ai_use_status : '';
        return {
          sourceId: row.id,
          subjectType: 'employee_assessment',
          position: positionOther || positionNames.get(positionId) || '其他或未说明',
          employeeAiUsage: {
            status: aiUseStatusLabels[status] || status || '未说明',
            tools: [...new Set(toolLabels)],
            scenarios: [...new Set(strings(row.ai_scenarios))],
            nonUseReasons: [...new Set(strings(row.non_use_reasons))],
            barriers: [...new Set([...strings(row.pain_points), ...strings(row.discontinuation_reasons)])],
          },
        };
      }),
      ...(positionResponses.data ?? []).map((row): DashboardResponseFact => ({
        sourceId: row.id,
        subjectType: 'position_survey',
        position: row.position_name || row.position_other || positionNames.get(row.position_id) || '其他或未说明',
      })),
    ];
    const responsePositionCoverage = new Map<string, number>();
    for (const fact of responseFacts) responsePositionCoverage.set(fact.position, (responsePositionCoverage.get(fact.position) || 0) + 1);
    const dashboardScenarios = result?.sampleSufficient
      ? result.scenarios.map((scenario) => ({ ...scenario, evidenceDimensions: scenario.evidenceDimensions ?? [] }))
      : [];
    const dto: AdminDashboardDto = {
      batch: { id: batch.data.id, name: batch.data.name },
      aggregateStatus: aggregate.data?.status ?? 'pending',
      sampleSufficient: result?.sampleSufficient ?? false,
      minSampleSize: readAggregateSampleSize(envValue('MIN_AGGREGATE_SAMPLE_SIZE'), isProductionRuntime(context)),
      validAnalysisSourceCount: analysisStatuses.get('complete') || 0,
      metrics: [
        { label: '有效答卷', value: total },
        { label: '具体需求场景', value: result?.scenarios.length ?? 0 },
        { label: '覆盖岗位', value: responsePositionCoverage.size },
        { label: '已完成分析', value: analysisStatuses.get('complete') || 0 },
      ],
      analysisStatuses: counts([...analysisStatuses].map(([label, count]) => ({ label, count }))),
      departmentCoverage: counts([...departmentCoverage].map(([label, count]) => ({ label, count }))),
      positionCoverage: counts([...responsePositionCoverage].map(([label, count]) => ({ label, count }))),
      heatmap: dashboardScenarios.flatMap((scenario) => scenario.positions.map((position) => ({ row: position, column: scenario.capabilityTheme, count: scenario.responseCount }))),
      dimensions: (dimensions.data ?? []).map((row) => ({
        dimensionKey: employeeDimensionDefinitions[Number(row.dimension_number) - 1]?.key ?? 'ai_suitability',
        dimension: employeeDimensionDefinitions[Number(row.dimension_number) - 1]?.name ?? `未知维度 ${row.dimension_number}`,
        description: employeeDimensionDefinitions[Number(row.dimension_number) - 1]?.description ?? '当前没有维度说明。',
        average: row.average_value === null ? null : Number(row.average_value),
        validSampleCount: Number(row.valid_sample_count),
      })),
      positionDemandMatrix: buildPositionDemandMatrix(responseFacts, dashboardScenarios, [...positionNames.values()]),
      aiUsageStats: buildAiUsageStats(responseFacts),
      scenarios: dashboardScenarios,
      lastCalculatedAt: aggregate.data?.updated_at,
      errorSummary: aggregate.data?.error_summary ?? undefined,
    };
    return jsonResponse(dto);
  } catch (error) {
    return errorResponse(error);
  }
}

export const config = { path: '/api/admin/dashboard', method: 'GET' };
