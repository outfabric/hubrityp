## MODIFIED Requirements

### Requirement: Create patient button is prominently displayed

The system SHALL render a "+ Novo Paciente" button prominently in the listing toolbar. **An "Importar CSV" button SHALL be rendered as a secondary action in the same toolbar.** Clicking "+ Novo Paciente" navigates to the creation form. Clicking "Importar CSV" navigates to the import page.

#### Scenario: Click create button

- **WHEN** psychologist clicks "+ Novo Paciente"
- **THEN** system navigates to the patient creation form at /app/pacientes/novo

#### Scenario: Click import button

- **WHEN** psychologist clicks "Importar CSV"
- **THEN** system navigates to /app/pacientes/importar
