// @vitest-environment jsdom
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RuleExamplesSchema } from '../../src/client/entities/rule-example';

const path = resolve(process.cwd(), 'public/data/how/rule-examples.json');
const raw = readFileSync(path, 'utf8');
const MAX_BYTES = 204_800;

describe('committed rule-examples file', () => {
  it('parses and is under the size budget', () => {
    expect(statSync(path).size).toBeLessThan(MAX_BYTES);
    expect(() => RuleExamplesSchema.parse(JSON.parse(raw))).not.toThrow();
  });

  it('holds exactly the case ids the How page wires, no more and no fewer', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { createHowPage } = await import('../../src/client/pages/how');
    const { exactCaseIds } = await import('../../src/client/pages/how/ui');
    const page = createHowPage({ page: 'how', section: null });
    const file = new Set(RuleExamplesSchema.parse(JSON.parse(raw)).cases.map((c) => c.id));
    const wired = new Set(exactCaseIds(page.el));
    expect(wired.size).toBeGreaterThan(0);
    expect([...wired].filter((id) => !file.has(id))).toEqual([]);
    expect([...file].filter((id) => !wired.has(id))).toEqual([]);
    page.destroy();
    vi.unstubAllGlobals();
  });

  it('has no em dash anywhere in the file', () => {
    expect(raw.includes('—')).toBe(false);
  });
});
