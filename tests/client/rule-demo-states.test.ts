import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RuleExamplesSchema } from '../../src/client/entities/rule-example';

const css = readFileSync(new URL('../../src/client/app/styles.css', import.meta.url), 'utf8');
const examples = RuleExamplesSchema.parse(JSON.parse(readFileSync(new URL('../../public/data/how/rule-examples.json', import.meta.url), 'utf8')));

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Offset of the last panel rule whose selector contains `part`, or -1. */
const lastRule = (part: string): number => {
  let at = -1;
  for (const m of css.matchAll(new RegExp(`\\.strv-rule-demo__svg [^{]*${escape(part)}[^{]*\\{`, 'g'))) at = m.index;
  return at;
};

describe('rule-demo states', () => {
  it('every state a published panel sets has a style', () => {
    const states = new Set(examples.cases.flatMap((c) => c.steps.flatMap((s) => Object.values(s.set ?? {}))));
    expect(states.size).toBeGreaterThan(0);
    for (const s of states) expect(lastRule(`[data-state='${s}']`), s).toBeGreaterThan(-1);
  });

  it('a state that recolors a block wins over the district fill', () => {
    // Scoped to district blocks and placed after the district colors, so the state's fill is the one drawn.
    const district = lastRule("[data-district='8']");
    expect(district).toBeGreaterThan(-1);
    for (const s of ['out', 'hot']) expect(lastRule(`[data-district][data-state='${s}']`), s).toBeGreaterThan(district);
  });
});
