import { z } from 'zod';
import rulesJson from '../../../../config/note-rules.json' with { type: 'json' };

/** The rules that screen a "why I signed" note (config/note-rules.json), validated once when first read. */
export const NoteRulesSchema = z.object({
  maxLength: z.number().int().min(1).max(2000),
  blockWords: z.array(z.string().min(1)).min(1),
  flagWords: z.array(z.string().min(1)),
});
export type NoteRules = z.infer<typeof NoteRulesSchema>;

export const NOTE_RULES: NoteRules = NoteRulesSchema.parse(rulesJson);
