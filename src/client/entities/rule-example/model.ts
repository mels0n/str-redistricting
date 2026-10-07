import { z } from 'zod';

// The client's own copy of the shape public/data/how/rule-examples.json is written in. It stands apart
// from the generator's schema on purpose: the viewer never imports server code.
const Int = z.number().int();
const Point = z.tuple([z.number(), z.number()]);

const Block = z.object({
  id: z.string().min(1),
  geoid: z.string().min(1),
  pop: Int.nonnegative(),
  ring: z.array(Point).min(3),
  tag: z.string().optional(),
  side: z.union([z.literal(0), z.literal(1)]).optional(),
  district: Int.optional(),
});

const Line = z.object({ id: z.string().min(1), pts: z.array(Point).min(2), tag: z.string().optional() });
const Label = z.object({ id: z.string().min(1), x: z.number(), y: z.number(), text: z.string(), tag: z.string().optional() });

const Step = z.object({
  caption: z.string().min(1),
  /** The ids on screen at this step. */
  show: z.array(z.string()),
  hide: z.array(z.string()).optional(),
  set: z.record(z.string(), z.string()).optional(),
  tween: z.array(z.object({ id: z.string().min(1), to: z.array(Point).min(2) })).optional(),
});

const Chart = z.object({
  kind: z.enum(['strip', 'bars', 'series']),
  values: z.array(z.number()),
  marks: z.record(z.string(), z.array(Int)).optional(),
});

/** One animated panel under an "exact rule" bullet. */
export const RuleCaseSchema = z.object({
  id: z.string().min(1),
  state: z.string().min(1),
  stateName: z.string().min(1),
  source: z.object({ cut: Int.optional(), move: Int.optional(), angleDeg: z.number().optional() }),
  link: z.object({ state: z.string().min(1), cut: Int.optional(), move: Int.optional() }),
  view: z.object({ w: z.number().positive(), h: z.number().positive() }),
  blocks: z.array(Block).optional(),
  lines: z.array(Line).optional(),
  labels: z.array(Label).optional(),
  steps: z.array(Step).min(1),
  chart: Chart.optional(),
  /** Set when no real case exists; the captions explain why. */
  missing: z.string().optional(),
});
export type RuleCase = z.infer<typeof RuleCaseSchema>;

export const RuleExamplesSchema = z.object({ version: z.literal(1), cases: z.array(RuleCaseSchema) });
export type RuleExamples = z.infer<typeof RuleExamplesSchema>;
