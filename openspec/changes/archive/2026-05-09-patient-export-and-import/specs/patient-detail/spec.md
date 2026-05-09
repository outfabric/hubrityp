## MODIFIED Requirements

### Requirement: Patient detail page has an actions menu

The system SHALL provide an actions menu (three-dot or dropdown) with options: Editar, Arquivar/Desarquivar (based on current status), **Exportar PDF**, and Excluir (only for patients without clinical records).

#### Scenario: Actions menu includes export option

- **WHEN** psychologist opens the actions menu for any patient
- **THEN** menu includes "Exportar PDF" option

#### Scenario: Export PDF from actions menu

- **WHEN** psychologist clicks "Exportar PDF" in the actions menu
- **THEN** system shows the secrecy confirmation dialog before generating PDF
