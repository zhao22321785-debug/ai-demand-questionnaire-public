import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps text-action labels on one line inside question navigation', () => {
  const globalCss = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
  expect(globalCss).toMatch(/\.text-action\s*\{[^}]*flex:\s*0 0 auto[^}]*white-space:\s*nowrap/s);
});
