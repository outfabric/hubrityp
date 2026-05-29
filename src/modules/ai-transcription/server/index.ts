// Server Action implementations for the ai-transcription module.
//
// Each implementation is a function that receives a Supabase client and raw
// input, validates auth + input, and returns a discriminated union result.
// Per the CLAUDE.md "Module shape" convention the review-flow impls carry NO
// `'use server'` directive — it lives at the call site (the review page's
// `actions.ts` wrapper for mutations; Server Components call the read impls
// directly).

export {
  requestAudioUploadUrlImpl,
  type RequestAudioUploadUrlResult,
} from './request-audio-upload-url';

export { confirmAudioUploadImpl, type ConfirmAudioUploadResult } from './confirm-audio-upload';

export { getTranscriptionForReviewImpl } from './get-transcription-for-review';
export { listTranscriptionsForReviewImpl } from './list-transcriptions';
export { updateTranscriptionDraftImpl } from './update-transcription-draft';
export { saveTranscriptionToProntuarioImpl } from './save-transcription-to-prontuario';
export { discardTranscriptionImpl } from './discard-transcription';

export {
  getTranscriptionSettingsImpl,
  type GetTranscriptionSettingsResult,
} from './get-transcription-settings';
export {
  updateTranscriptionSettingsImpl,
  type UpdateTranscriptionSettingsResult,
} from './update-transcription-settings';
export {
  getTranscriptionStatsImpl,
  type GetTranscriptionStatsResult,
} from './get-transcription-stats';
