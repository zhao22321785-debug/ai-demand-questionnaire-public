# Profile Reuse, In-Question Navigation, and Preview Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate employee profile questions, place navigation under each question, and add ten clearly tagged preview users with seven employee and three position responses.

**Architecture:** Keep `user_profiles` as the editable source and continue embedding a profile snapshot in each employee response, so no schema or RPC change is required. Move only `StepLayout` actions into the question section, preserving `SurveyLayout` for non-question pages. Generate preview data through Supabase Auth and authenticated save RPCs, then run the existing Netlify background analysis endpoints and aggregate endpoint.

**Tech Stack:** React 19, React Router 7, TypeScript 5.9, Vitest, Testing Library, Playwright, Supabase Auth/Postgres/RLS, Netlify Functions, Node.js 22.

## Approved Change — 2026-07-24

The user selected the no-migration option after final security review. This section overrides any conflicting Task 3 or Task 4 text below.

- Preview seeding is create-once. Abort before writes if any Auth email starts with `preview-seed-20260724-`.
- Do not expose `--replace`; do not ship or run an automated cleanup command.
- Do not claim that deleting Auth users removes revision history, analysis jobs/results, or aggregate snapshots.
- On a partial failure, stop subsequent analysis/aggregation, preserve tagged partial data, and report only non-secret IDs and the failing stage. Do not auto-delete created users.
- Complete cleanup requires a separately approved server-side cleanup RPC or database migration and is outside this iteration.
- Before the first write, the seed runner must verify the exact Preview alias, reject redirects, and verify the remote runtime is the non-production deterministic mock connected to the approved Supabase project.

## Global Constraints

- Remote writes are limited to Supabase project `exampleprojectref123` and the non-production Netlify Preview alias.
- Do not merge `main` or create a production deploy.
- Do not add a database migration or change RLS for this feature.
- Do not expose or persist service-role, secret, generated passwords, or session tokens.
- Seed users must use the exact prefix `preview-seed-20260724-` and must not touch `personal@example.com` or existing `preview-main-*` users.
- Preview analysis remains deterministic mock mode; do not add a real OpenAI call.
- Administrators remain read-only in the product UI.

---

### Task 1: Reuse the Saved User Profile in the Employee Survey

**Files:**
- Create: `src/features/profile/profile-validation.ts`
- Create: `tests/unit/employee-survey-profile.test.tsx`
- Modify: `src/features/profile/ProfilePage.tsx`
- Modify: `src/features/employee-survey/EmployeeSurveyPage.tsx`
- Modify: `src/app/SessionBoundaries.tsx`
- Modify: `tests/unit/employee-survey-batch-guard.test.tsx`

**Interfaces:**
- Produces: `isCompleteUserProfile(profile: UserProfileInput | null | undefined): profile is UserProfileInput`.
- Consumes: `SurveyDataClient.getProfile()`, `SurveyDataClient.getReferenceData()`, and the existing `EmployeeSurveyInput.profile` snapshot.

- [ ] **Step 1: Add failing profile-reuse tests**

Create `tests/unit/employee-survey-profile.test.tsx` with three explicit cases:

```tsx
it('starts with the AI usage question and does not repeat profile inputs', async () => {
  renderSurvey({ profile: completeProfile });
  expect(await screen.findByRole('heading', { name: '您目前在工作中使用 AI 的情况是？' })).toBeInTheDocument();
  expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
});

it('blocks an employee survey when the saved profile is incomplete', async () => {
  renderSurvey({ profile: null });
  expect(await screen.findByRole('heading', { name: '请先补充基本资料' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '补充基本资料' })).toHaveAttribute(
    'href',
    '/survey/profile?returnTo=%2Fsurvey%2Femployee',
  );
});

it('uses the saved profile as the response snapshot', async () => {
  const saveEmployeeSurvey = vi.fn().mockResolvedValue({ id: crypto.randomUUID(), revision: 1, analysisStatus: 'pending' });
  renderSurvey({ profile: completeProfile, saveEmployeeSurvey });
  await completeNoDemandSurvey();
  expect(saveEmployeeSurvey).toHaveBeenCalledWith(expect.objectContaining({ profile: completeProfile }));
});
```

Update `tests/unit/employee-survey-batch-guard.test.tsx` so every fake client implements `getProfile()` and remove the click that previously left the profile step.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```powershell
npx vitest run tests/unit/employee-survey-profile.test.tsx tests/unit/employee-survey-batch-guard.test.tsx
```

Expected: the new tests fail because the employee survey still renders `填写基本信息` and the client does not yet use `getProfile()`.

- [ ] **Step 3: Add one shared profile completeness predicate**

Create `src/features/profile/profile-validation.ts`:

```ts
import type { UserProfileInput } from '../../types/survey';

export function isCompleteUserProfile(
  profile: UserProfileInput | null | undefined,
): profile is UserProfileInput {
  if (!profile?.name.trim() || !profile.departmentId || !profile.positionId || !profile.currentPositionExperience) return false;
  if (profile.departmentId === 'other' && !profile.departmentOther?.trim()) return false;
  if (profile.positionId === 'other' && !profile.positionOther?.trim()) return false;
  return true;
}
```

Use the predicate in `ProfilePage.tsx` instead of maintaining a second validation expression. Read `returnTo` with `useSearchParams()` and navigate only when it begins with `/survey/`; otherwise return to `/survey/identity`.

- [ ] **Step 4: Remove the employee profile step and load the profile once**

In `EmployeeSurveyPage.tsx`:

```ts
type Step = 'ai-status' | 'ai-detail' | 'pain-points' | 'demand' | 'tasks' | 'dimensions';
const steps: Step[] = ['ai-status', 'ai-detail', 'pain-points', 'demand', 'tasks', 'dimensions'];
const [step, setStep] = useState<Step>('ai-status');
const [profile, setProfile] = useState<UserProfileInput | null>(null);
const [profileLoadState, setProfileLoadState] = useState<'loading' | 'ready' | 'incomplete' | 'failed'>('loading');
```

Load reference data and profile together. Set `ready` only when `isCompleteUserProfile(profile)` is true. For edit mode, load the response fields but do not replace the current profile with `record.input.profile`; a newly saved revision must use the current saved profile.

Before rendering a question, return a `StepLayout` state for `loading`, `incomplete`, and `failed`. The incomplete state contains:

```tsx
<Link to="/survey/profile?returnTo=%2Fsurvey%2Femployee">补充基本资料</Link>
```

Delete the entire `step === 'profile'` form branch, `experienceOptions`, and `profileValid()`.

- [ ] **Step 5: Add a persistent basic-profile entry**

Update `SurveySessionBoundary`:

```tsx
<div className="session-controls">
  <Link to="/survey/profile">基本资料</Link>
  <Link to="/survey/responses">我的答卷</Link>
  <button type="button" onClick={...}>退出登录</button>
</div>
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npx vitest run tests/unit/employee-survey-profile.test.tsx tests/unit/employee-survey-batch-guard.test.tsx tests/unit/app-smoke.test.tsx
```

Expected: all focused tests pass.

Commit only Task 1 files:

```powershell
git add src/features/profile/profile-validation.ts src/features/profile/ProfilePage.tsx src/features/employee-survey/EmployeeSurveyPage.tsx src/app/SessionBoundaries.tsx tests/unit/employee-survey-profile.test.tsx tests/unit/employee-survey-batch-guard.test.tsx
git commit -m "fix: reuse saved profile in employee survey"
```

### Task 2: Move Question Navigation Under the Current Question

**Files:**
- Create: `tests/unit/step-layout.test.tsx`
- Modify: `src/components/form/StepLayout.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/m1-flow.spec.ts`

**Interfaces:**
- Produces: `.question-step__actions`, a content-aligned action container rendered inside `.question-step`.
- Consumes: the existing `actions?: ReactNode` prop; no caller signature changes.

- [ ] **Step 1: Add a failing layout ownership test**

Create `tests/unit/step-layout.test.tsx`:

```tsx
it('renders question actions inside the question section instead of the page footer', () => {
  const { container } = render(
    <MemoryRouter>
      <StepLayout module="员工需求调研" progress="1 / 6" title="测试题" actions={<button>下一题</button>}>
        <div>题目内容</div>
      </StepLayout>
    </MemoryRouter>,
  );
  expect(container.querySelector('.question-step .question-step__actions')).toContainElement(
    screen.getByRole('button', { name: '下一题' }),
  );
  expect(container.querySelector('.survey-page__footer')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the layout test and confirm failure**

Run:

```powershell
npx vitest run tests/unit/step-layout.test.tsx
```

Expected: failure because actions currently render in `.survey-page__footer`.

- [ ] **Step 3: Render and style the in-question action container**

Update `StepLayout.tsx` so `SurveyLayout` receives no footer and the section ends with:

```tsx
<div className="question-step__body">{children}</div>
{actions ? <div className="question-step__actions">{actions}</div> : null}
```

Add to `src/styles/global.css`:

```css
.question-step__actions {
  display: flex;
  width: min(840px, 100%);
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-top: var(--space-8);
}

@media (max-width: 767px) {
  .question-step__actions { align-items: flex-start; flex-wrap: wrap; }
}
```

Do not remove `.survey-page__footer`; it remains a generic layout feature.

- [ ] **Step 4: Update the full browser flow**

In `tests/e2e/m1-flow.spec.ts`:

- Remove the second set of name, department, position, and experience interactions from `fillEmployeeSurvey()`.
- Remove the `填写基本信息` assertion and initial next click from `reviseEmployeeSurvey()`.
- Add `expectQuestionActionsNearBody(page)` that compares `.question-step__body` and `.question-step__actions` bounding boxes and asserts the vertical gap is between `0` and `96` pixels.
- Run this assertion once on an option question in both Playwright projects.

- [ ] **Step 5: Run focused unit and browser tests, then commit**

Run:

```powershell
npx vitest run tests/unit/step-layout.test.tsx
npx playwright test tests/e2e/m1-flow.spec.ts --project=desktop
npx playwright test tests/e2e/m1-flow.spec.ts --project=mobile
```

Expected: unit test passes and both browser projects pass.

Commit only Task 2 files:

```powershell
git add src/components/form/StepLayout.tsx src/styles/global.css tests/unit/step-layout.test.tsx tests/e2e/m1-flow.spec.ts
git commit -m "fix: keep survey navigation near question content"
```

### Task 3: Add Repeatable Preview Seed and Cleanup Scripts

**Files:**
- Create: `scripts/preview-seed-data.mjs`
- Create: `scripts/seed-preview-data.mjs`
- Create: `scripts/cleanup-preview-data.mjs`
- Create: `tests/unit/preview-seed-data.test.mjs`
- Modify: `package.json`
- Modify: `docs/runbook.md`

**Interfaces:**
- Produces: `SEED_PREFIX`, `buildPreviewSeed(referenceData)`, and two runtime commands: `npm run seed:preview` and `npm run cleanup:preview-seed`.
- Consumes environment variables `PREVIEW_SEED_SUPABASE_URL`, `PREVIEW_SEED_PUBLISHABLE_KEY`, `PREVIEW_SEED_SERVICE_KEY`, `PREVIEW_SEED_PREVIEW_URL`, and `PREVIEW_SEED_INTERNAL_SECRET`.

- [ ] **Step 1: Add failing deterministic fixture tests**

Create `tests/unit/preview-seed-data.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { SEED_PREFIX, buildPreviewSeed } from '../../scripts/preview-seed-data.mjs';

it('builds ten distinct users with seven employee and three position responses', () => {
  const seed = buildPreviewSeed(referenceFixture);
  expect(seed).toHaveLength(10);
  expect(new Set(seed.map((item) => item.email)).size).toBe(10);
  expect(seed.filter((item) => item.kind === 'employee')).toHaveLength(7);
  expect(seed.filter((item) => item.kind === 'position')).toHaveLength(3);
  expect(seed.every((item) => item.email.startsWith(SEED_PREFIX))).toBe(true);
});

it('aligns every position survey with at least one seeded employee position', () => {
  const seed = buildPreviewSeed(referenceFixture);
  const employeePositions = new Set(seed.filter((item) => item.kind === 'employee').map((item) => item.profile.positionId));
  expect(seed.filter((item) => item.kind === 'position').every((item) => employeePositions.has(item.payload.positionId))).toBe(true);
});
```

Use a reference fixture containing at least three departments, three positions, two AI tools, and an active batch.

- [ ] **Step 2: Run the fixture test and confirm failure**

Run:

```powershell
npx vitest run tests/unit/preview-seed-data.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Build deterministic, valid payload fixtures**

Create `scripts/preview-seed-data.mjs` with:

```js
export const SEED_PREFIX = 'preview-seed-20260724-';

export function buildPreviewSeed(reference) {
  // Resolve department, position, and tool IDs from the supplied reference rows.
  // Return exactly seven employee entries followed by three position entries.
}
```

Each entry must contain a unique email, a `预览员工 01` through `预览负责人 03` display name, a complete profile, and a payload satisfying the current `EmployeeSurveyInput` or `PositionSurveyInput` contract. Include overlapping themes such as interview-note organization, test-case generation, development troubleshooting, document review, and cross-team handoff while preserving distinct source evidence.

- [ ] **Step 4: Implement the guarded seed runner**

Create `scripts/seed-preview-data.mjs` that:

1. Fails before network access unless all five `PREVIEW_SEED_*` variables are present.
2. Creates separate public and service Supabase clients with `persistSession: false`.
3. Loads the active batch and reference tables from the service client.
4. Lists Auth users and aborts if any existing email starts with `SEED_PREFIX` unless `--replace` is present.
5. For each fixture, generates an in-memory random password, calls `auth.admin.createUser({ email, password, email_confirm: true })`, signs in through the publishable client, saves `user_profiles`, then calls the authenticated `save_employee_assessment` or `save_position_survey` RPC.
6. Calls `${PREVIEW_SEED_PREVIEW_URL}/api/internal/analyze-background` with `x-analysis-secret` for every saved subject.
7. Polls `analysis_jobs` with a bounded 180-second deadline and stops immediately on `failed`.
8. Calls `/api/internal/aggregate` only after all ten current jobs are complete.
9. Prints counts and non-secret IDs only; never prints passwords, tokens, or keys.
10. On a partial failure, deletes only users created in the current process and then exits non-zero.

- [ ] **Step 5: Implement exact-prefix cleanup without running it**

Create `scripts/cleanup-preview-data.mjs` that requires `PREVIEW_SEED_SUPABASE_URL`, `PREVIEW_SEED_SERVICE_KEY`, and an explicit `--confirm-prefix=preview-seed-20260724-` argument. It lists Auth users, selects only exact-prefix emails, prints the count, deletes those Auth users, and verifies the remaining exact-prefix count is zero. Do not run this command during seeding.

- [ ] **Step 6: Add commands and runbook instructions**

Add to `package.json`:

```json
"seed:preview": "node scripts/seed-preview-data.mjs",
"cleanup:preview-seed": "node scripts/cleanup-preview-data.mjs"
```

Document the required environment variables, non-production boundary, exact prefix, `--replace`, and cleanup confirmation in `docs/runbook.md`. State that seed output is mock analysis evidence, not model-quality evidence.

- [ ] **Step 7: Run tests and commit**

Run:

```powershell
npx vitest run tests/unit/preview-seed-data.test.mjs
npm run check:secrets
```

Expected: fixture tests pass and secret scan has zero findings.

Commit only Task 3 files:

```powershell
git add scripts/preview-seed-data.mjs scripts/seed-preview-data.mjs scripts/cleanup-preview-data.mjs tests/unit/preview-seed-data.test.mjs package.json docs/runbook.md
git commit -m "feat: add guarded preview survey seeding"
```

### Task 4: Integrate, Verify, Deploy Preview, and Seed Ten Users

**Files:**
- Modify if required: files from Tasks 1-3 only.
- Do not create a migration.
- Do not commit screenshots, credentials, or `.netlify` state.

**Interfaces:**
- Consumes: `npm run verify`, `npm run test:e2e`, Netlify Preview context, and the Task 3 seed command.
- Produces: updated `origin/feat/m1-foundation`, refreshed Preview alias, ten tagged users, ten complete single analyses, and one current complete aggregate.

- [ ] **Step 1: Run the complete local gate**

Run:

```powershell
npm run verify
npm run test:e2e
npm audit --audit-level=high
```

Expected: all unit/integration tests pass, all 18 desktop/mobile E2E scenarios pass after count updates, build succeeds, secret scan passes, and audit reports zero high-or-higher vulnerabilities.

- [ ] **Step 2: Perform a scope and security review**

Verify:

```powershell
git diff origin/feat/m1-foundation...HEAD --stat
git status --short
```

Review that no migration, service key, generated password, token, `.env`, `.netlify`, or test-result screenshot is staged.

- [ ] **Step 3: Push the feature branch and update only Preview**

Push `feat/m1-foundation`. Redeploy the alias:

```text
https://public-preview--ai-demand-questionnaire.netlify.app
```

Use the existing non-production `branch-deploy`, `deploy-preview`, and `branch:m1-preview` configuration. Do not write or modify production context variables.

- [ ] **Step 4: Run the guarded seed command once**

Load the five required variables only into the current process, verify the target URL contains project ref `exampleprojectref123`, and run:

```powershell
npm run seed:preview
```

Expected final non-secret summary:

```text
created_users=10
employee_responses=7
position_responses=3
complete_current_analysis=10
failed_or_nonterminal_jobs=0
aggregate_status=complete
```

- [ ] **Step 5: Verify the remote matrix without deleting data**

Use read-only SQL to verify exact-prefix users, response counts, current analysis results, and the latest aggregate source count. Confirm the real administrator `personal@example.com` remains `admin/active` and is not part of the seed prefix.

- [ ] **Step 6: Perform visible browser verification**

Using the existing administrator account, verify and capture local artifacts for:

- employee survey first question with no repeated profile fields;
- desktop and mobile in-question navigation;
- an employee recap from seeded data;
- a position recap from seeded data;
- D1 totals;
- D2 scenario and source answers;
- D3 employee/manager comparison.

Do not commit artifacts.

- [ ] **Step 7: Final branch and boundary confirmation**

Confirm local `HEAD` equals `origin/feat/m1-foundation`, the worktree is clean, Preview returns HTTP 200, `main` is unchanged, production has no new deploy, and all ten seed users remain available for the user to inspect.
