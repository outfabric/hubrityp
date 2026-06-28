// Waiting-room presence constants for telepsychology video rooms.
//
// Single source of truth for how long a patient heartbeat stays "fresh" on the
// psychologist's screen. The patient page polls/heartbeats every ~10s; we
// tolerate roughly two missed beats before declaring the patient gone so a
// single flaky network round-trip does not flap the "Paciente aguardando"
// badge. 10s poll x 3 windows = 30s.

/**
 * Time-to-live for a patient liveness heartbeat. While
 * `Date.now() - patient_last_seen_at < WAITING_PRESENCE_TTL_MS`, the patient is
 * considered present in the waiting room. Past the TTL with no further
 * heartbeats the badge auto-clears (covers the no-beacon-on-exit case).
 */
export const WAITING_PRESENCE_TTL_MS = 20_000;
