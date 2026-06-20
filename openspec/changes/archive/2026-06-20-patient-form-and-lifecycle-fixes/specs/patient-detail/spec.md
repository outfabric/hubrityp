## MODIFIED Requirements

### Requirement: Patient detail page has an actions menu

The system SHALL provide an actions menu (three-dot or dropdown) with options: Editar, Arquivar/Desarquivar (based on current status), **Exportar PDF**, and Excluir (only for patients without clinical records). The Arquivar/Desarquivar label SHALL be derived from the patient's current persisted status and SHALL reflect the true status after a lifecycle mutation followed by any client-side navigation — after archiving, the menu MUST offer "Desarquivar"; after unarchiving, it MUST offer "Arquivar" — with no stale label served from a non-invalidated cache.

#### Scenario: Actions menu for active patient

- **WHEN** psychologist opens the actions menu for an active patient
- **THEN** menu shows: "Editar", "Arquivar", and conditionally "Excluir" (only if patient has no sessions/anamnesis/consent)

#### Scenario: Actions menu for archived patient

- **WHEN** psychologist opens the actions menu for an archived patient
- **THEN** menu shows: "Editar", "Desarquivar", and conditionally "Excluir"

#### Scenario: Archive action shows confirmation modal

- **WHEN** psychologist clicks "Arquivar" in the actions menu
- **THEN** system displays a confirmation modal explaining legal retention obligation (CFP 5 anos / Lei 13.787/2018 20 anos) with "Confirmar" and "Cancelar" buttons

#### Scenario: Actions menu includes export option

- **WHEN** psychologist opens the actions menu for any patient
- **THEN** menu includes "Exportar PDF" option

#### Scenario: Export PDF from actions menu

- **WHEN** psychologist clicks "Exportar PDF" in the actions menu
- **THEN** system shows the secrecy confirmation dialog before generating PDF

#### Scenario: Label reflects new status after archive and navigation

- **WHEN** psychologist archives a patient from the detail page, navigates away (e.g. to the listing), and re-opens the same patient
- **THEN** the actions menu offers "Desarquivar", reflecting the persisted archived status (it does not revert to "Arquivar")
