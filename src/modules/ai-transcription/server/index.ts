// Server Action implementations for the ai-transcription module.
//
// Each implementation is a function that receives a Supabase client and raw
// input, validates auth + input, and returns a discriminated union result.
// The `'use server'` directive lives on each implementation file.

export {
  requestAudioUploadUrlImpl,
  type RequestAudioUploadUrlResult,
} from './request-audio-upload-url';

export { confirmAudioUploadImpl, type ConfirmAudioUploadResult } from './confirm-audio-upload';

export { getTranscriptionForReviewImpl } from './get-transcription-for-review';
export { updateTranscriptionDraftImpl } from './update-transcription-draft';
export { saveTranscriptionToProntuarioImpl } from './save-transcription-to-prontuario';
export { discardTranscriptionImpl } from './discard-transcription';
