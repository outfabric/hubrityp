// Shared time-window constants for telepsychology video rooms.
//
// These values are the single source of truth for how a room's accessibility
// window is computed. Both `reserveVideoRoom` (schedule-time reservation) and
// `createVideoRoomHelper` (activation) import them so the two code paths can
// never drift apart.

/** Minutes before session start when the room becomes available. */
export const ROOM_AVAILABLE_BEFORE_MINUTES = 10;

/** Hours after session end when the room expires. */
export const ROOM_EXPIRES_AFTER_HOURS = 1;
