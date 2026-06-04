## ADDED Requirements

### Requirement: Patient user is registered in Stream before receiving the Stream JWT
The `/api/video/join` Route Handler SHALL call `streamClient.upsertUsers()` to register the patient (or partner) user in Stream's user database BEFORE returning the Stream JWT in the `status === 'active'` response. The user SHALL be upserted with the synthetic ID matching the JWT's `user_id` claim (`patient-<patientId>` for patients). The patient's display name SHALL be fetched from the `patients` table.

#### Scenario: Patient user is upserted when room is active
- **WHEN** a POST to `/api/video/join` with a valid patient_token is received and the room status is 'active'
- **THEN** `streamClient.upsertUsers()` is called with the patient's synthetic user ID and display name before the response containing the Stream JWT is returned

#### Scenario: Partner user is upserted when room is active
- **WHEN** a POST to `/api/video/join` with a valid partner_token is received and the room status is 'active'
- **THEN** `streamClient.upsertUsers()` is called with the partner's synthetic user ID before the response containing the partner Stream JWT is returned

#### Scenario: No upsert for non-active rooms
- **WHEN** a POST to `/api/video/join` results in status 'waiting', 'too_early', or an error
- **THEN** no `upsertUsers()` call is made (the Stream JWT is not returned in these cases)

#### Scenario: Upsert failure returns 500
- **WHEN** `streamClient.upsertUsers()` throws during the join route
- **THEN** a 500 response with `{ error: 'INTERNAL_ERROR' }` is returned and the error is logged
