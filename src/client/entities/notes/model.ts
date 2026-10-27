import { z } from 'zod';

/** What /api/notes answers: approved notes that signers chose to show. Name and town are present only when the signer allowed it. */
export const NotesResponseSchema = z.object({
  notes: z.array(z.object({ body: z.string().min(1), name: z.string().nullable(), town: z.string().nullable(), at: z.string() })),
});
export type PublicNote = z.infer<typeof NotesResponseSchema>['notes'][number];
