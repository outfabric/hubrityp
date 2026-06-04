## ADDED Requirements

### Requirement: Client-side call.join errors are logged with details
When `call.join()` fails in the psychologist's pre-call lobby or the patient's in-call view, the actual error from the Stream SDK SHALL be logged via `console.error` with a `[telepsicologia]` prefix. The error SHALL NOT be swallowed. The user-facing error message SHALL remain generic (no raw error details exposed to the UI).

#### Scenario: Psychologist join failure is logged
- **WHEN** `call.join()` rejects in the pre-call lobby
- **THEN** `console.error('[telepsicologia] call.join failed', error)` is called with the actual Stream error, and the generic error message is shown to the user

#### Scenario: Patient join failure is logged
- **WHEN** `call.join()` rejects in the patient in-call view
- **THEN** `console.error('[telepsicologia] call.join failed', error)` is called with the actual Stream error
