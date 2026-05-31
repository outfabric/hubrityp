## ADDED Requirements

### Requirement: Notification bell shows the unread count in the app header
The system SHALL render a notification bell (Lucide `Bell`) in the authenticated app header with a badge showing the count of unread notifications for the logged-in psychologist. The count MUST come from an owner-scoped query (`read_at IS NULL` for `user_id = auth.uid()`). The bell MUST be a `'use client'` leaf and meet the design-system standalone-icon a11y rule (`aria-label`).

#### Scenario: Unread count reflects the owner's notifications only
- **GIVEN** the psychologist has 3 unread notifications and another psychologist has 5
- **WHEN** the header renders
- **THEN** the bell shows a badge of 3

#### Scenario: No unread notifications shows no badge
- **GIVEN** the psychologist has zero unread notifications
- **WHEN** the header renders
- **THEN** the bell renders without a count badge

### Requirement: Notification dropdown lists notifications with type icon and relative time
The system SHALL render a dropdown panel when the bell is activated, listing the owner's notifications newest-first with a per-type Lucide icon, the title, and a relative timestamp formatted with date-fns locale `pt-BR` ("há 5 min", "ontem"). The panel MUST offer "Marcar todas como lidas". Clicking a notification MUST route to its action target and mark it read. Only the MVP notification types SHALL be rendered with an icon/route: `session_confirmed`, `session_cancelled`, `evolution_pending`, `consent_signed`, `ai_note_ready`, `ai_risk_alert`, `system_notice`. Unknown/post-MVP types MUST NOT render a payment/Receita/WhatsApp affordance.

#### Scenario: Notifications render with relative timestamps
- **GIVEN** the owner has a `session_confirmed` notification created 5 minutes ago
- **WHEN** they open the dropdown
- **THEN** it shows the title with the icon mapped to `session_confirmed` and "há 5 min"

#### Scenario: Clicking a notification marks it read and routes
- **GIVEN** an unread `evolution_pending` notification with an action target
- **WHEN** the psychologist clicks it
- **THEN** `markNotificationRead` runs for that notification (owner-scoped) and the browser routes to the action target

#### Scenario: Mark-all marks only the owner's notifications
- **WHEN** the psychologist clicks "Marcar todas como lidas"
- **THEN** `markAllNotificationsRead` sets `read_at` only on rows where `user_id = auth.uid()`

#### Scenario: Post-MVP notification types are not surfaced
- **WHEN** the dropdown renders
- **THEN** no payment-received, Receita Saúde, or WhatsApp-message notification affordance is shown

### Requirement: Read actions are session-scoped and IDOR-safe
The system SHALL implement `listNotifications`, `getUnreadCount`, `markNotificationRead(id)`, and `markAllNotificationsRead` as Server Actions that authenticate via `supabase.auth.getUser()`, validate inputs with Zod, and authorize from the session — `markNotificationRead` MUST update the row only when `id = :input.id AND user_id = auth.uid()` (or rely on RLS to scope it), never on `id` alone. Errors MUST be sanitized.

#### Scenario: Marking another user's notification read affects zero rows
- **GIVEN** notification N belongs to psychologist A
- **WHEN** psychologist B calls `markNotificationRead(N.id)`
- **THEN** zero rows are updated and no error leaks A's data

#### Scenario: Invalid id is rejected by validation
- **WHEN** `markNotificationRead` is called with a non-UUID id
- **THEN** the Zod boundary rejects it before any query runs

### Requirement: Unread count updates in realtime
The system SHALL subscribe to Supabase Realtime `postgres_changes` on the `notifications` table filtered by the owner's `user_id`, so a new notification (inserted by a background job) updates the bell's unread count live without a page refresh (RNF-11.04). The subscription MUST reuse the established realtime pattern and MUST be scoped so a client never receives another user's rows.

#### Scenario: New notification bumps the live count
- **GIVEN** the psychologist has the dashboard open with the bell showing 1 unread
- **WHEN** a background job inserts a new notification for that psychologist
- **THEN** the bell's count updates to 2 without a manual refresh

#### Scenario: Realtime channel is owner-filtered
- **WHEN** the realtime subscription is created
- **THEN** it filters on `user_id = <owner>` so events for other psychologists are never delivered to this client

### Requirement: Notifications older than 30 days are auto-read
The system SHALL provide an Inngest scheduled function that marks notifications older than 30 days as read (sets `read_at`) so they move to history (RF-11.17). The function SHALL run with the service-role client (justified comment, not user-reachable) and SHALL be registered in the Inngest serve route. It MUST NOT delete rows.

#### Scenario: Old unread notifications are marked read
- **GIVEN** an unread notification created 31 days ago
- **WHEN** the auto-read scheduled function runs
- **THEN** that notification's `read_at` is set and the row is not deleted

### Requirement: Notification preferences are editable with critical email locked on
The system SHALL provide a Configurações > Notificações page that reads and updates the owner's `notification_preferences` row (`email_daily`, `email_weekly`, `email_critical`, `in_app_sound`) via an RLS-scoped Server Action. The `email_critical` toggle MUST be presented as locked-on and the server action MUST reject any attempt to set it to false (critical notifications are mandatory). The page is gated by the existing `/configuracoes` middleware classification.

#### Scenario: Critical email cannot be disabled
- **WHEN** a request attempts to set `email_critical = false`
- **THEN** the Server Action rejects it (or coerces it to true) and persists `email_critical = true`

#### Scenario: Anonymous access to the preferences page is redirected
- **WHEN** an anonymous client visits `/configuracoes/notificacoes`
- **THEN** the middleware redirects to `/login?redirectTo=%2Fconfiguracoes%2Fnotificacoes`

#### Scenario: Preferences update is owner-scoped
- **WHEN** psychologist B attempts to update psychologist A's preferences row
- **THEN** zero rows are affected (RLS scope)
