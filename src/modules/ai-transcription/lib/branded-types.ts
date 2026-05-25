import { z } from 'zod';

/**
 * Branded UUID type for transcription records.
 * Prevents accidental assignment of a raw `string` where a validated
 * `TranscriptionId` is expected — catches ID mix-ups at compile time.
 */
export const TranscriptionIdSchema = z.string().uuid().brand<'TranscriptionId'>();

export type TranscriptionId = z.infer<typeof TranscriptionIdSchema>;
