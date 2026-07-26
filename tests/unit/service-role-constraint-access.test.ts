import sql from '../../supabase/migrations/20260724170000_grant_dimension_validator_to_service_role.sql?raw';

it('lets only the service worker execute the employee dimension validator', () => {
  expect(sql).toMatch(
    /grant execute on function private\.is_valid_dimension_answers\(jsonb\) to service_role/i,
  );
  expect(sql).not.toMatch(/to\s+(?:public|anon|authenticated)\b/i);
});
