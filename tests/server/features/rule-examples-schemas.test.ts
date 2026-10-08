import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuleExamplesSchema as ServerSchema } from '../../../src/server/features/rule-examples/index.js';

const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/how/rule-examples.json'), 'utf8'));

// The client schema is checked in tests/client/rule-examples-published.test.ts: server code may not import client code.
describe('committed rule-examples.json', () => {
  it('parses under the server schema that writes it', () => {
    const r = ServerSchema.safeParse(raw);
    expect(r.success, 'server schema rejects the file; rerun `npm run rule-examples`').toBe(true);
  });
});
