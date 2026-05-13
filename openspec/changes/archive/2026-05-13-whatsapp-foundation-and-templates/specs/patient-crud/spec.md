## MODIFIED Requirements

### Requirement: Patient create/edit form includes WhatsApp reminder controls

The system SHALL extend the patient create and edit forms with a "LEMBRETES WHATSAPP" section containing: (1) a Switch "Receber lembretes via WhatsApp" (default ON), (2) a conditional Textarea for opt-out reason (visible only when switch is OFF), and (3) an optional Input for alternative reminder phone (E.164 validated). These fields map to the `whatsapp_opt_out`, `whatsapp_opt_out_at`, and `reminder_phone` columns on the patients table.

#### Scenario: WhatsApp section visible on create form

- **WHEN** psychologist opens the new patient form
- **THEN** the "LEMBRETES WHATSAPP" section is visible with the switch defaulting to ON

#### Scenario: WhatsApp section visible on edit form with persisted state

- **WHEN** psychologist opens the edit form for a patient with whatsapp_opt_out=true
- **THEN** the switch shows OFF and the reason Textarea is visible with the stored reason

#### Scenario: Patient input schema includes opt-out fields

- **WHEN** the patient create/update input schema is validated
- **THEN** it accepts optional fields: whatsapp_opt_out (boolean), reminder_phone (string, E.164 format)
