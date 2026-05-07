## ADDED Requirements

### Requirement: Psychologist can export patient data as PDF

The system SHALL generate a PDF with the patient's cadastral data and anamnesis. Before including anamnesis/clinical data, the system MUST show a confirmation dialog warning about professional secrecy (sigilo profissional).

#### Scenario: Export PDF with cadastral data only

- **WHEN** psychologist clicks "Exportar PDF" and declines to include clinical data
- **THEN** system generates a PDF with: full_name, birth_date/age, phone, email, cpf (masked), address, profession, marital_status, source, tags, notes, status, created_at

#### Scenario: Export PDF with clinical data after confirmation

- **WHEN** psychologist clicks "Exportar PDF", confirms inclusion of clinical data in the secrecy warning dialog
- **THEN** system generates a PDF that additionally includes anamnesis sections content

#### Scenario: PDF download is immediate (no storage)

- **WHEN** PDF is generated
- **THEN** system streams the PDF as a download response (no permanent storage in bucket)

#### Scenario: Export for patient without anamnesis

- **WHEN** psychologist exports a patient that has no anamnesis record
- **THEN** PDF contains only cadastral data; the clinical section shows "Sem anamnese registrada"

### Requirement: Exported PDF includes psychologist identification

The system SHALL include the psychologist's name and CRP number in the PDF header as the issuing professional.

#### Scenario: PDF header shows psychologist info

- **WHEN** PDF is generated
- **THEN** the document header includes "Emitido por: {psychologist_name} — CRP {crp_uf}/{crp_number}" and the export date
