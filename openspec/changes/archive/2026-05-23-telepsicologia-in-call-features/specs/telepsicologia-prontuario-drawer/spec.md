## ADDED Requirements

### Requirement: Prontuario side drawer during video call
The psychologist SHALL have access to a prontuario side drawer during the video call, showing recent evolutions and a quick evolution creation form. The drawer SHALL use the existing prontuario module's Server Components with RLS-scoped data access.

#### Scenario: Psychologist opens prontuario drawer
- **WHEN** the psychologist clicks the prontuario toggle (FileText icon) during a call
- **THEN** a side drawer opens showing the patient's recent evolutions and a form to add a new evolution

#### Scenario: Prontuario drawer is psychologist-only
- **WHEN** the patient views their call controls
- **THEN** no prontuario toggle button is visible

#### Scenario: Evolution auto-saves during call
- **WHEN** the psychologist types an evolution note in the drawer
- **THEN** the content auto-saves every 10 seconds with a "Salvo as HH:MM" indicator
