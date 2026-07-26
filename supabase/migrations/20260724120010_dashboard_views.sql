create view public.admin_response_statistics
with (security_invoker = true)
as
select
  assessment.batch_id,
  'employee'::text as survey_type,
  profile.department_id,
  profile.position_id,
  profile.current_position_experience as experience,
  assessment.analysis_status,
  count(*)::bigint as response_count
from public.employee_assessments assessment
join public.user_profiles profile on profile.user_id = assessment.user_id
group by assessment.batch_id, profile.department_id, profile.position_id, profile.current_position_experience, assessment.analysis_status
union all
select
  survey.batch_id,
  'position'::text as survey_type,
  survey.department_id,
  survey.position_id,
  survey.related_position_experience as experience,
  survey.analysis_status,
  count(*)::bigint as response_count
from public.position_demand_surveys survey
group by survey.batch_id, survey.department_id, survey.position_id, survey.related_position_experience, survey.analysis_status;

create view public.admin_dimension_statistics
with (security_invoker = true)
as
select
  assessment.batch_id,
  dimension.ordinality::smallint as dimension_number,
  count(*) filter (where jsonb_typeof(dimension.answer) = 'number')::bigint as valid_sample_count,
  avg((dimension.answer #>> '{}')::numeric) filter (where jsonb_typeof(dimension.answer) = 'number') as average_value
from public.employee_assessments assessment
cross join lateral jsonb_array_elements(assessment.dimension_answers) with ordinality as dimension(answer, ordinality)
group by assessment.batch_id, dimension.ordinality;

revoke all on public.admin_response_statistics, public.admin_dimension_statistics from anon, authenticated;
grant select on public.admin_response_statistics, public.admin_dimension_statistics to authenticated;
