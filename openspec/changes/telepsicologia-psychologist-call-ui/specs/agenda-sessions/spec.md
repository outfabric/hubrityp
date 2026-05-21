## MODIFIED Requirements

### Requirement: Online session cards show "Iniciar video" action
Session cards in the agenda for sessions with modality='online' and status IN ('scheduled', 'confirmed') SHALL display an "Iniciar video" button with the Video Lucide icon. Clicking the button SHALL navigate to `/sessao/[sessionId]/video`.

#### Scenario: Online session shows video button
- **WHEN** a session card is rendered for a session with modality='online' and status='scheduled'
- **THEN** an "Iniciar video" button is visible

#### Scenario: In-person session does not show video button
- **WHEN** a session card is rendered for a session with modality='in_person'
- **THEN** no "Iniciar video" button is visible
