-- Deliberately excluded from migrations.
-- Run only as service_role/owner after reviewing the target project and
-- receiving explicit write approval. The RPC validates draft/version/window,
-- closes the previous active batch, and activates this batch atomically.
select public.activate_survey_batch('50000000-0000-4000-8000-000000000001');
