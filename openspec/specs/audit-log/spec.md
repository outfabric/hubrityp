# audit-log Specification

## Purpose

Defines the generic, reusable `audit_log` table and its access patterns for recording who accessed sensitive resources, when, and from where. Designed for reuse across medical-records, billing, and any future domain requiring an immutable access trail. RLS enforces read-own-only with no direct INSERT/UPDATE/DELETE from the authenticated role; writes go through a server-only path (service-role or SECURITY DEFINER function). Created by archiving change `prontuario-foundation-and-evolutions`.

## Requirements

### Requirement: Generic audit_log table records access to sensitive resources

The system SHALL maintain a generic `audit_log` table with columns: id (uuid PK), user_id (uuid, FK auth.users), action (text, e.g. 'prontuario.read', 'evolution.read', 'evolution.create'), resource_type (text, e.g. 'evolution', 'patient'), resource_id (uuid, nullable), metadata (jsonb, default '{}'), ip_address (inet, nullable), created_at (timestamptz). The table MUST be designed for reuse by PRD 11 and other domains beyond medical-records.

#### Scenario: Audit log row created on prontuario read

- **WHEN** psychologist opens the prontuario page for a patient
- **THEN** system inserts an `audit_log` row with action='prontuario.read', resource_type='patient', resource_id=patient_id, user_id=auth.uid()

#### Scenario: Audit log row created on evolution read

- **WHEN** psychologist views a specific evolution detail
- **THEN** system inserts an `audit_log` row with action='evolution.read', resource_type='evolution', resource_id=evolution_id, user_id=auth.uid()

#### Scenario: Audit log captures IP address when available

- **WHEN** an audit event fires from a Server Action with access to request headers
- **THEN** the `ip_address` column is populated from the `x-forwarded-for` or `x-real-ip` header

### Requirement: Audit log RLS allows user to SELECT own rows only

The system SHALL enable RLS on `audit_log` with a SELECT policy scoped to `user_id = auth.uid()`. There SHALL be no INSERT policy for the `authenticated` role — writes MUST go through a server-side path (service-role or SECURITY DEFINER function) to prevent tampering. There SHALL be no UPDATE or DELETE policies (audit trail is immutable).

#### Scenario: User can read own audit entries

- **WHEN** psychologist queries `audit_log`
- **THEN** only rows where `user_id` matches the psychologist's auth.uid() are returned

#### Scenario: User cannot INSERT directly via RLS

- **WHEN** an authenticated client (non-service-role) attempts to INSERT into `audit_log`
- **THEN** the INSERT is rejected by RLS (no INSERT policy for authenticated role)

#### Scenario: No UPDATE or DELETE possible

- **WHEN** any user attempts to UPDATE or DELETE from `audit_log`
- **THEN** the operation is rejected (no UPDATE/DELETE policies exist)

### Requirement: Audit log has performant indexes for common queries

The system SHALL create indexes on `audit_log`: a composite index on (user_id, created_at DESC) for "my recent activity" queries, and a composite index on (resource_type, resource_id) for "who accessed this resource" queries.

#### Scenario: User activity query uses index

- **WHEN** querying audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50
- **THEN** the query plan uses the `idx_audit_log_user_created` index

#### Scenario: Resource access query uses index

- **WHEN** querying audit_log WHERE resource_type = 'evolution' AND resource_id = $1
- **THEN** the query plan uses the `idx_audit_log_resource` index

### Requirement: Audit log write path is server-only

The system SHALL expose a `logProntuarioAccess` server function in the medical-records module that writes audit_log rows using a service-role connection (bypassing RLS). This function MUST validate inputs via Zod, authenticate the caller via `supabase.auth.getUser()`, and use the authenticated user's ID as `user_id` (never trust client-supplied user_id). The service-role usage MUST be justified in a code comment.

#### Scenario: logProntuarioAccess writes audit entry

- **WHEN** a Server Action calls `logProntuarioAccess({ action: 'evolution.read', resourceType: 'evolution', resourceId: '...' })`
- **THEN** system inserts a row in `audit_log` with the caller's auth.uid() as user_id

#### Scenario: logProntuarioAccess rejects unauthenticated calls

- **WHEN** `logProntuarioAccess` is called without a valid session
- **THEN** the function throws an authentication error without writing any row
