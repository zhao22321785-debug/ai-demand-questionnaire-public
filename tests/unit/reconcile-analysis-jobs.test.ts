import { processWithBudget } from '../../netlify/functions/reconcile-analysis-jobs';

it('isolates an item failure and continues while total budget remains', async () => {
  let clock = 0;
  const visited: number[] = [];
  const failures: number[] = [];
  const result = await processWithBudget([1, 2, 3], {
    budgetMs: 50,
    minimumRemainingMs: 5,
    now: () => clock,
    run: async (item) => {
      visited.push(item);
      clock += 10;
      if (item === 1) throw new Error('one item failed');
      if (item === 2) clock += 40;
    },
    onError: (item) => failures.push(item),
  });
  expect(visited).toEqual([1, 2]);
  expect(failures).toEqual([1]);
  expect(result).toEqual({ processed: 2, remainingMs: 0 });
});
