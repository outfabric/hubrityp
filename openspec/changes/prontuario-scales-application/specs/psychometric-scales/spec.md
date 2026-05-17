## ADDED Requirements

### Requirement: Scale library provides pre-configured public-domain scales

The system SHALL include a built-in library of psychometric scales: PHQ-9 (depression), GAD-7 (anxiety), SDQ 11-17 self-report (strengths and difficulties), AUDIT (alcohol use), and WHOQOL-Bref (quality of life). Each scale definition SHALL include: key, label, description, estimated completion time, list of questions with options, a scoring function, and a classification function. The system SHALL NOT include BDI-II or BAI (proprietary, Pearson copyright).

#### Scenario: PHQ-9 scale is available with 9 questions

- **WHEN** the system loads the PHQ-9 scale definition
- **THEN** it returns a definition with key='phq9', 9 questions, each with options valued 0-3, and label "PHQ-9 (Depressao)"

#### Scenario: GAD-7 scale is available with 7 questions

- **WHEN** the system loads the GAD-7 scale definition
- **THEN** it returns a definition with key='gad7', 7 questions, each with options valued 0-3, and label "GAD-7 (Ansiedade)"

#### Scenario: AUDIT scale is available with 10 questions

- **WHEN** the system loads the AUDIT scale definition
- **THEN** it returns a definition with key='audit', 10 questions, and label "AUDIT (Uso de Alcool)"

#### Scenario: SDQ self-report is available with 25 questions

- **WHEN** the system loads the SDQ scale definition
- **THEN** it returns a definition with key='sdq', 25 questions (including reverse-scored prosocial items), and label "SDQ (Capacidades e Dificuldades)"

#### Scenario: WHOQOL-Bref is available with 26 questions across 4 domains

- **WHEN** the system loads the WHOQOL-Bref scale definition
- **THEN** it returns a definition with key='whoqol-bref', 26 questions grouped into Physical, Psychological, Social, and Environmental domains

### Requirement: Scoring functions compute correct total scores with classification

The system SHALL automatically compute scores using each scale's scoring algorithm and classify the result according to clinically validated thresholds. PHQ-9: 0-4 minimal, 5-9 mild, 10-14 moderate, 15-19 moderately severe, 20-27 severe. GAD-7: 0-4 minimal, 5-9 mild, 10-14 moderate, 15-21 severe. AUDIT: 0-7 low risk, 8-15 risky use, 16-19 harmful use, 20-40 likely dependence. SDQ (total difficulties): 0-15 normal, 16-19 borderline, 20-40 abnormal. WHOQOL-Bref: 4 domain scores transformed to 0-100 each (no single total).

#### Scenario: PHQ-9 boundary score 4 classifies as minimal

- **WHEN** PHQ-9 responses sum to 4
- **THEN** classification returns label "Minimo" with severity "minimal"

#### Scenario: PHQ-9 boundary score 5 classifies as mild

- **WHEN** PHQ-9 responses sum to 5
- **THEN** classification returns label "Leve" with severity "mild"

#### Scenario: PHQ-9 score 14 classifies as moderate

- **WHEN** PHQ-9 responses sum to 14
- **THEN** classification returns label "Moderado" with severity "moderate"

#### Scenario: PHQ-9 score 15 classifies as moderately severe

- **WHEN** PHQ-9 responses sum to 15
- **THEN** classification returns label "Moderadamente grave" with severity "severe"

#### Scenario: PHQ-9 score 20 classifies as severe

- **WHEN** PHQ-9 responses sum to 20
- **THEN** classification returns label "Grave" with severity "severe"

#### Scenario: GAD-7 boundary score 9/10

- **WHEN** GAD-7 responses sum to 9
- **THEN** classification returns severity "mild"
- **WHEN** GAD-7 responses sum to 10
- **THEN** classification returns severity "moderate"

#### Scenario: AUDIT boundary score 7/8

- **WHEN** AUDIT responses sum to 7
- **THEN** classification returns severity "minimal" (low risk)
- **WHEN** AUDIT responses sum to 8
- **THEN** classification returns severity "mild" (risky use)

#### Scenario: SDQ reverse-scored items handled correctly

- **WHEN** SDQ responses include prosocial items (questions 1, 4, 9, 17, 20)
- **THEN** scoring function excludes prosocial subscale from total difficulties score (only sums emotional, conduct, hyperactivity, peer problems subscales)

#### Scenario: WHOQOL-Bref produces 4 domain scores

- **WHEN** WHOQOL-Bref responses are complete
- **THEN** scoring function returns null for total_score and classification contains 4 domain scores each in 0-100 range

### Requirement: Psychologist can apply a scale in-session

The system SHALL allow a psychologist to create a scale application for a patient during a session. The psychologist selects a scale, answers the questions with the patient present, and submits. The system computes the score and classification, persists the application with `applied_remotely = false`, and writes an audit_log entry with action='scale.create'.

#### Scenario: Create in-session PHQ-9 application

- **WHEN** psychologist selects PHQ-9 for patient X and chooses "Aplicar agora (na sessao)"
- **THEN** system creates a scale_applications row with user_id=psychologist, patient_id=X, scale_key='phq9', applied_remotely=false, remote_token=NULL

#### Scenario: Submit in-session responses scores and classifies

- **WHEN** psychologist submits 9 PHQ-9 responses (all valued 0-3) for an in-session application
- **THEN** system sets total_score to the sum, classification to the matching threshold label, completed_at to now(), and returns the score + classification to the psychologist

#### Scenario: Duplicate submission for completed application rejected

- **WHEN** psychologist attempts to submit responses for an application that already has completed_at set
- **THEN** system returns error code 'ALREADY_COMPLETED' without modifying the row

### Requirement: Psychologist can generate a remote link for patient self-report

The system SHALL allow a psychologist to generate a secure, time-limited link for a patient to complete a scale remotely. The link contains a cryptographically secure 64-character hex token (256 bits entropy). The psychologist chooses an expiration period (24h, 48h, or 7 days). The generated URL follows the pattern `/escala/{token}`.

#### Scenario: Generate remote link with 24h expiration

- **WHEN** psychologist creates a remote application for PHQ-9 with expiresInHours=24
- **THEN** system creates a row with applied_remotely=true, remote_token=64-hex-chars, token_expires_at=now()+24h, completed_at=NULL

#### Scenario: Token is cryptographically secure

- **WHEN** a remote token is generated
- **THEN** it is 64 hex characters (32 bytes from crypto.randomBytes), providing 256 bits of entropy

#### Scenario: Remote URL returned to psychologist

- **WHEN** remote application is created successfully
- **THEN** system returns the full URL (base + /escala/ + token) for the psychologist to share with the patient

### Requirement: Patient can submit responses via public token-gated route

The system SHALL expose a public page at `/escala/[token]` where the patient can view and answer the scale questions without authentication. The page SHALL NOT display the patient's name, the psychologist's name, or any identifying information. On submission, the system validates the token, checks expiry and completion status, scores the responses, and persists them.

#### Scenario: Valid token renders questionnaire

- **WHEN** patient navigates to `/escala/{valid-unexpired-token}`
- **THEN** page renders the scale questions with RadioGroup per question, a submit button "Enviar respostas", and an LGPD footer

#### Scenario: Expired token shows friendly message

- **WHEN** patient navigates to `/escala/{token}` where token_expires_at < now()
- **THEN** page renders "Este link expirou. Solicite um novo ao seu psicologo." without any clinical or identifying data

#### Scenario: Already-completed token shows confirmation

- **WHEN** patient navigates to `/escala/{token}` where completed_at is not null
- **THEN** page renders "Este questionario ja foi respondido." without revealing the score

#### Scenario: Successful public submission persists score

- **WHEN** patient submits valid responses via the public form
- **THEN** system computes total_score and classification, sets completed_at, and writes audit_log with action='scale.public-submit' including IP in metadata

#### Scenario: Public submission does NOT reveal score to patient

- **WHEN** patient successfully submits responses
- **THEN** page shows "Obrigado. Suas respostas foram enviadas ao seu psicologo." without displaying the score or classification

#### Scenario: Public page leaks no PII

- **WHEN** the public route handler returns data for a valid token
- **THEN** the response contains ONLY scale definition (key, questions) and status flags (isExpired, isCompleted) — never user_id, patient_id, patient name, or psychologist name

### Requirement: Public route is rate-limited

The system SHALL apply IP-based rate limiting to the public scale endpoints. GET requests are limited to 20/minute per IP. POST requests are limited to 5/minute per IP. Exceeding the limit returns HTTP 429.

#### Scenario: POST rate limit exceeded

- **WHEN** the same IP makes 6 POST requests to `/api/scales/{token}` within 1 minute
- **THEN** the 6th request receives HTTP 429 without processing the submission

#### Scenario: GET rate limit exceeded

- **WHEN** the same IP makes 21 GET requests to `/api/scales/{token}` within 1 minute
- **THEN** the 21st request receives HTTP 429

### Requirement: Token expiry enforced at submission time

The system SHALL reject public submissions where `token_expires_at < now()` at the moment of the POST request. The cron job `scales/expire-remote-tokens` runs hourly for observability but is NOT the primary enforcement mechanism.

#### Scenario: Submission rejected for expired token

- **WHEN** patient POST responses to a token where token_expires_at < now()
- **THEN** system returns error code 'EXPIRED' and does NOT persist any responses

#### Scenario: Token just before expiry is accepted

- **WHEN** patient POST responses to a token where token_expires_at is 1 second in the future
- **THEN** system accepts the submission and processes normally

### Requirement: Inngest cron expires remote tokens hourly

The system SHALL run an Inngest scheduled function `scales/expire-remote-tokens` every hour (cron `0 * * * *`, timezone America/Sao_Paulo). This function provides observability on expired tokens and can perform cleanup operations. The primary expiry enforcement remains in the submission validation logic.

#### Scenario: Cron runs every hour

- **WHEN** the clock reaches the top of any hour (Sao Paulo timezone)
- **THEN** the Inngest function `scales/expire-remote-tokens` executes

#### Scenario: Cron identifies expired tokens

- **WHEN** the cron runs and there are scale_applications with token_expires_at < now() AND completed_at IS NULL
- **THEN** the function logs the count of expired-but-uncompleted tokens for observability

### Requirement: Psychologist can view scale application history with timeseries

The system SHALL allow a psychologist to view the full history of scale applications for a patient, optionally filtered by scale type. The history includes a timeseries dataset suitable for chart rendering (date, score, classification per point). Applications are ordered by applied_at descending.

#### Scenario: History returns all applications for a patient

- **WHEN** psychologist requests scale history for patient X without filter
- **THEN** system returns all scale_applications for patient X owned by the psychologist, ordered by applied_at DESC

#### Scenario: History filtered by scale key

- **WHEN** psychologist requests scale history for patient X with scaleKey='phq9'
- **THEN** system returns only PHQ-9 applications for patient X

#### Scenario: Timeseries data includes score and classification per point

- **WHEN** psychologist requests history for patient X with 3 PHQ-9 applications
- **THEN** response includes timeseries array with 3 entries, each containing appliedAt, totalScore, and classification

### Requirement: Longitudinal Recharts line chart visualizes score evolution

The system SHALL render a Recharts LineChart showing the patient's score progression over time for a given scale. The chart line uses brand-500 color. Each data point (dot) is colored by classification severity: success-500 for minimal, warning-500 for mild/moderate, danger-500 for severe. The tooltip shows date + score + classification label. The chart grid uses surface-muted. WHOQOL-Bref renders 4 domain lines instead of a single score line.

#### Scenario: Chart renders with 3+ data points

- **WHEN** a patient has 3 PHQ-9 applications with scores [4, 12, 7]
- **THEN** chart renders a line with 3 dots: first dot in success-500 (minimal), second in warning-500 (moderate), third in warning-500 (mild)

#### Scenario: Tooltip shows date and classification

- **WHEN** user hovers over a chart dot
- **THEN** tooltip displays the application date (dd/MM format), total score, and classification label

#### Scenario: WHOQOL-Bref chart renders 4 domain lines

- **WHEN** patient has WHOQOL-Bref applications
- **THEN** chart renders 4 separate lines (one per domain: Physical, Psychological, Social, Environmental) instead of a single score line

### Requirement: Scales tab replaces placeholder in prontuario shell

The system SHALL replace the "Em breve" placeholder for the "Escalas" tab in the prontuario shell with a functional ScalesTab component. The tab header displays "Escalas aplicadas" (h3), a primary button "Aplicar nova escala" with icon ClipboardCheck, and summary cards for each scale ever applied showing: scale label, last application date, last score with Badge colored by severity, and an optional sparkline preview.

#### Scenario: Escalas tab shows applied scales summary

- **WHEN** psychologist navigates to prontuario and selects "Escalas" tab
- **THEN** the tab renders a card per scale ever applied, each showing the scale name, last application date, and a Badge with the last classification colored by severity

#### Scenario: Escalas tab with no applications shows empty state

- **WHEN** psychologist views Escalas tab for a patient with no scale applications
- **THEN** tab renders Salvia empty state: ClipboardCheck icon in text-tertiary, h4 "Nenhuma escala aplicada", description, and CTA button "Aplicar nova escala"

#### Scenario: "Ver historico completo" opens chart Sheet

- **WHEN** psychologist clicks "Ver historico completo" on a scale summary card
- **THEN** a Sheet opens (right side) with the full Recharts timeseries line chart for that scale

### Requirement: Apply scale flow with mode selection

The system SHALL provide a multi-step flow for applying a new scale: Step 1 — select scale (RadioGroup with scale cards showing label, description, estimated time). Step 2 — choose mode: "Aplicar agora (na sessao)" or "Enviar link ao paciente" with expiration select (24h/48h/7 dias). In-session mode renders questions inline. Remote mode generates and displays the link with a "Copiar link" button.

#### Scenario: Step 1 shows all available scales

- **WHEN** psychologist clicks "Aplicar nova escala"
- **THEN** a modal/page renders RadioGroup with 5 scale options (PHQ-9, GAD-7, SDQ, AUDIT, WHOQOL-Bref), each showing label, description, and estimated minutes

#### Scenario: Step 2 in-session mode renders questions

- **WHEN** psychologist selects PHQ-9 and chooses "Aplicar agora (na sessao)"
- **THEN** the 9 PHQ-9 questions render inline with RadioGroup per question and a "Salvar no prontuario" submit button

#### Scenario: Step 2 remote mode shows generated link

- **WHEN** psychologist selects GAD-7 and chooses "Enviar link ao paciente" with 48h expiration
- **THEN** system creates the remote application and displays the full URL with a "Copiar link" button

### Requirement: RLS isolates scale applications per psychologist

The system SHALL enforce row-level security on `scale_applications` so that psychologist A can never read, insert, or update scale applications belonging to psychologist B. Policies are scoped via `auth.uid() = user_id`. No DELETE policy exists (Lei 13.787/2018 retention mandate).

#### Scenario: Psychologist B cannot SELECT psychologist A's scale applications

- **WHEN** psychologist B queries scale_applications
- **THEN** zero rows belonging to psychologist A are returned, even if patient_id is known

#### Scenario: Psychologist B cannot UPDATE psychologist A's scale applications

- **WHEN** psychologist B attempts to UPDATE a row where user_id belongs to psychologist A
- **THEN** the UPDATE affects zero rows (RLS blocks)

#### Scenario: No DELETE is possible

- **WHEN** any authenticated user attempts to DELETE from scale_applications
- **THEN** the operation is rejected (no DELETE policy exists)

### Requirement: Audit log records all scale operations

The system SHALL write audit_log entries for: scale application creation (action='scale.create'), in-session submission (action='scale.submit'), public submission (action='scale.public-submit' with IP in metadata), and scale history read (action='scale.history-read'). Audit writes use the service-role path established in `prontuario-foundation-and-evolutions`. Public submission audit entries SHALL NOT contain patient_id or user_id of the psychologist in metadata — only the scale_application ID and IP.

#### Scenario: In-session creation logs audit entry

- **WHEN** psychologist creates an in-session scale application
- **THEN** audit_log receives a row with action='scale.create', resource_type='scale_application', resource_id=new_id, user_id=psychologist_id

#### Scenario: Public submission logs audit with IP

- **WHEN** patient submits responses via the public route from IP 203.0.113.42
- **THEN** audit_log receives a row with action='scale.public-submit', resource_type='scale_application', resource_id=application_id, ip_address='203.0.113.42', and metadata does NOT contain patient_id or psychologist user_id

#### Scenario: History read logs audit entry

- **WHEN** psychologist views scale history for a patient
- **THEN** audit_log receives a row with action='scale.history-read', resource_type='patient', resource_id=patient_id

### Requirement: Middleware classifies /escala as public

The system SHALL explicitly classify paths starting with `/escala` as PathClass `'public'` in `classifyPath()`. This ensures the public patient-facing scale form is accessible without authentication. The classification MUST be explicit (not relying on the default fallthrough) to document intent and protect against future changes to the default.

#### Scenario: Unauthenticated GET to /escala/[token] passes through

- **WHEN** an unauthenticated user requests GET `/escala/abc123def456`
- **THEN** middleware returns pass (no redirect to login)

#### Scenario: Authenticated user can also access /escala/[token]

- **WHEN** an authenticated psychologist navigates to `/escala/abc123def456`
- **THEN** middleware returns pass (public routes are accessible to all)

#### Scenario: /escala is classified before default fallthrough

- **WHEN** `classifyPath('/escala/abc123')` is called
- **THEN** it returns `'public'` via an explicit check, not by reaching the default return statement

### Requirement: Public page provides LGPD notice

The system SHALL display a footer on the public scale page containing the text: "Suas respostas sao protegidas pela LGPD e serao acessiveis apenas ao seu psicologo." This informs the patient of data protection without requiring a separate consent flow (consent was obtained by the psychologist when initiating the scale application).

#### Scenario: LGPD footer visible on public page

- **WHEN** patient views the public scale page
- **THEN** a footer element contains the LGPD protection notice text

### Requirement: Token generation uses cryptographically secure randomness

The system SHALL generate remote tokens using `crypto.randomBytes(32).toString('hex')` (or equivalent Web Crypto API), producing 64 hex characters with 256 bits of entropy. UUID v4 (122 bits) is insufficient for clinical data protection.

#### Scenario: Generated token is 64 hex characters

- **WHEN** a remote scale application is created
- **THEN** the remote_token value is exactly 64 characters long and contains only hexadecimal characters [0-9a-f]

#### Scenario: Token uses crypto.randomBytes

- **WHEN** token generation function is invoked
- **THEN** it calls Node.js crypto.randomBytes(32) or equivalent, not Math.random() or UUID
