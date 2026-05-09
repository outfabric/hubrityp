## ADDED Requirements

### Requirement: Psychologist can generate a consent term for a patient

The system SHALL allow the psychologist to generate a consent term linked to a specific patient. The term includes a unique token (64-char hex, crypto.randomBytes), the term text (editable template stored per psychologist), and metadata. The generated link format is `/termo/{token}`.

#### Scenario: Generate consent term

- **WHEN** psychologist clicks "Enviar termo de consentimento" on patient detail page
- **THEN** system creates a `consent_terms` record with a unique token, the psychologist's term template text, and returns the public link

#### Scenario: Copy consent link

- **WHEN** psychologist clicks "Copiar link" after generating the term
- **THEN** system copies the URL `/termo/{token}` to clipboard with success toast

#### Scenario: Open WhatsApp with consent link

- **WHEN** psychologist clicks "Enviar por WhatsApp"
- **THEN** system opens `https://wa.me/{patient_phone}?text={encoded_message_with_link}` in a new tab

### Requirement: Patient can sign consent term via public link

The system SHALL serve a public page at `/termo/:token` (no authentication required) where the patient reads the term text and can accept or refuse. Acceptance records: IP, user-agent, timestamp, and creates an electronic signature valid under MP 2.200-2/2001 art. 10, §2º.

#### Scenario: Patient reads and accepts term

- **WHEN** patient opens the consent link, reads the term, checks "Li e aceito os termos", and clicks "Assinar"
- **THEN** system records signed_at=now, signed_ip, signed_user_agent, and generates a PDF of the signed term

#### Scenario: Patient refuses term

- **WHEN** patient opens the consent link and clicks "Recusar"
- **THEN** system records the refusal (no signed_at set) and shows message "Termo recusado. Caso tenha dúvidas, entre em contato com seu psicólogo."

#### Scenario: Token already used (term already signed)

- **WHEN** patient opens a consent link that was already signed
- **THEN** system shows message "Este termo já foi assinado em {date}" and does not allow re-signing

#### Scenario: Invalid token

- **WHEN** someone opens `/termo/invalid-token`
- **THEN** system shows 404 page "Termo não encontrado"

### Requirement: Signed consent generates PDF and updates patient record

The system SHALL generate a PDF of the signed consent term (including psychologist identification, term text, signature timestamp, and IP) using pdfkit. The PDF is stored in Supabase Storage bucket `consent-pdfs` (private). The patient's `consent_signed_at` field is updated.

#### Scenario: PDF contains required information

- **WHEN** consent is signed and PDF is generated
- **THEN** PDF includes: psychologist name and CRP, patient name, full term text, signature timestamp, IP address, and statement of electronic signature validity

#### Scenario: PDF is stored in private bucket

- **WHEN** PDF is generated
- **THEN** it is stored at `consent-pdfs/{user_id}/{patient_id}/{consent_term_id}.pdf` in a private Supabase Storage bucket

#### Scenario: Patient consent_signed_at is updated

- **WHEN** consent is signed
- **THEN** patient record's consent_signed_at is set to the signing timestamp

### Requirement: Psychologist can revoke a consent term

The system SHALL allow the psychologist to revoke a consent term by setting `revoked_at` on the consent_terms record and clearing `consent_signed_at` on the patient. Revocation triggers a visual warning on the patient detail page.

#### Scenario: Revoke consent

- **WHEN** psychologist clicks "Revogar consentimento" on patient detail page and confirms
- **THEN** consent_terms.revoked_at is set, patient.consent_signed_at is cleared, and patient detail shows warning "Consentimento revogado — atendimento deve ser cessado"

### Requirement: Consent term for minor goes to guardian

The system SHALL send the consent link to the primary guardian's phone (not the minor patient's phone) when the patient is a child or adolescent.

#### Scenario: Generate consent for minor patient

- **WHEN** psychologist generates consent term for a child patient with primary guardian "Ana Silva" (+5511988776655)
- **THEN** the "Enviar por WhatsApp" button uses the guardian's phone number, not the patient's

### Requirement: Default term template includes legally required content

The system SHALL provide a default consent term template that includes: psychologist identification (name, CRP), service description, LGPD data treatment clause (base legal: execução de contrato + tutela da saúde), data subject rights, retention period, session recording policy (optional), session fee, and cancellation policy. The psychologist MAY customize this template.

#### Scenario: Default template has all required sections

- **WHEN** psychologist generates their first consent term (no custom template saved)
- **THEN** system uses the default template containing all legally required sections

#### Scenario: Psychologist customizes template

- **WHEN** psychologist edits and saves a custom term template
- **THEN** future consent terms use the customized template

### Requirement: RLS enforces owner-scoped access on consent_terms

The system SHALL enable RLS on `consent_terms`. The psychologist can access only their own consent terms (via `user_id = auth.uid()`). The public signing endpoint MUST use service-role to read/write the consent record (bypasses RLS).

#### Scenario: Psychologist can only see own consent terms

- **WHEN** psychologist queries consent_terms table
- **THEN** only rows where user_id matches their auth.uid() are returned

#### Scenario: Public signing page reads term via service role

- **WHEN** patient accesses /termo/:token
- **THEN** the server reads the consent_terms record using service-role client (not scoped to any user)
