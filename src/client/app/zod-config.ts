import { z } from 'zod';

/**
 * Validation runs without generated code. The faster path builds functions
 * from strings, which a Content-Security-Policy without 'unsafe-eval' blocks
 * and reports as a violation. Data files are small, so nothing is lost.
 * This file is imported first, before any schema is created.
 */
z.config({ jitless: true });
