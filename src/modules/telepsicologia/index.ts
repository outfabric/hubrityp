// Public API of the `telepsicologia` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/telepsicologia`,
// never from internal paths like `@/modules/telepsicologia/server/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports Server Action implementations, pure helpers,
// and types. If it carried `'use server'`, every export would be transformed
// into an RPC stub by the Next.js compiler and the schema/type re-exports
// would break.
//
// The `'use server'` directives live on the route shells under `src/app/`
// which import the implementations from this barrel and re-export them as
// bona fide Server Actions for the Next.js compiler.
//
// `getCurrentProfileEdge`-style note: the Edge-safe surface for future
// middleware consumption lives in `@/modules/telepsicologia/edge`. Bundling
// Drizzle + Stream SDK into an Edge worker crashes with
// `Native module not found: node:crypto`, so the Edge-safe subset is
// published through a dedicated entrypoint (`edge.ts`).

// ---- Server Actions (delegated to by the route shells) -----------------------
export { admitPatientImpl, type AdmitPatientResult } from './server/admit-patient';
export { createVideoRoomImpl, type CreateVideoRoomResult } from './server/create-video-room';
export {
  createVideoRoomHelper,
  type CreateVideoRoomHelperResult,
  type SessionData as VideoRoomSessionData,
} from './server/create-video-room-helper';
export { endVideoSessionImpl, type EndVideoSessionResult } from './server/end-video-session';
export { extendSessionImpl, type ExtendSessionResult } from './server/extend-session';
export { getVideoTokenImpl, type GetVideoTokenResult } from './server/get-video-token';
export { toggleRecordingImpl, type ToggleRecordingResult } from './server/toggle-recording';

// ---- Zod Schemas -------------------------------------------------------------
export {
  videoRoomInputSchema,
  type VideoRoomInput,
  videoTokenInputSchema,
  type VideoTokenInput,
  toggleRecordingInputSchema,
  type ToggleRecordingInput,
  type ToggleRecordingAction,
  extendSessionInputSchema,
  type ExtendSessionInput,
  VIDEO_ROOM_STATUSES,
  type VideoRoomStatus,
} from './lib/schemas';

// ---- Types (Drizzle-inferred — canonical row shape) -------------------------
export type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';

// ---- Components --------------------------------------------------------------
export {
  default as VideoCallClient,
  type VideoCallClientProps,
} from './components/video-call-client';
export { PreCallLobby } from './components/pre-call-lobby';
export { InCallView } from './components/in-call-view';
export { CallControlBar } from './components/call-control-bar';
export { PostCallView } from './components/post-call-view';
export { EndCallDialog } from './components/end-call-dialog';
export { ConnectionQualityIndicator } from './components/connection-quality-indicator';
export { ElapsedTime } from './components/elapsed-time';
export { ScreenShareIndicator } from './components/screen-share-indicator';
export { PatientVideoPage } from './components/patient-video-page';

// patient join flow
export { BrowserCheck } from './components/browser-check';
export { TooEarlyView } from './components/too-early-view';
export { WaitingRoomView } from './components/waiting-room-view';
export { PatientInCallView } from './components/patient-in-call-view';
export { SessionEndedView } from './components/session-ended-view';
export { DeviceTest } from './components/device-test';

// in-call chat
export { ChatDrawer } from './components/chat-drawer';
export { ChatMessageList } from './components/chat-message-list';
export { ChatInput } from './components/chat-input';
export { MAX_CHAT_MESSAGE_LENGTH } from './lib/chat-types';
export type { ChatMessage, ChatCustomEventPayload } from './lib/chat-types';

// in-call prontuario
export { ProntuarioCallDrawer } from './components/prontuario-call-drawer';
export { ProntuarioCallContent } from './components/prontuario-call-content';

// in-call troubleshooting
export { TroubleshootingPopover } from './components/troubleshooting-popover';

// ---- Pure helpers ------------------------------------------------------------
export { generatePatientVideoUrl } from './lib/video-url';
