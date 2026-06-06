import { describe, expect, it } from 'vitest';

import {
  ROOM_AVAILABLE_BEFORE_MINUTES,
  ROOM_EXPIRES_AFTER_HOURS,
} from '@/modules/telepsicologia/lib/room-constants';

// These constants are the single source of truth for the room accessibility
// window. They are imported by both `reserveVideoRoom` and
// `createVideoRoomHelper`; pinning the values here guards against an accidental
// edit silently shifting the window for every scheduled online session.

describe('room-constants', () => {
  it('exposes a 10-minute pre-start availability window', () => {
    expect(ROOM_AVAILABLE_BEFORE_MINUTES).toBe(10);
  });

  it('exposes a 1-hour post-end expiry window', () => {
    expect(ROOM_EXPIRES_AFTER_HOURS).toBe(1);
  });
});
