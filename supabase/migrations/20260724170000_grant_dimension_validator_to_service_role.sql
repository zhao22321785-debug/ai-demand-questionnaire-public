-- Employee analysis finalization updates analysis_status on a row whose CHECK
-- constraint calls this immutable validator. The worker runs as service_role,
-- so it needs EXECUTE on the validator while anon/authenticated remain denied.
grant execute on function private.is_valid_dimension_answers(jsonb) to service_role;
