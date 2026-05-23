## MODIFIED Requirements

### Requirement: In-call layout includes screen share display and indicators
The psychologist's in-call view SHALL display a "Voce esta compartilhando sua tela" overlay when screen sharing is active, with a "Parar de compartilhar" button. Stream's SpeakerLayout SHALL handle the automatic layout switch to show the shared screen as the main content.

#### Scenario: Screen share overlay visible during sharing
- **WHEN** the psychologist is sharing their screen
- **THEN** a "Voce esta compartilhando sua tela" banner and "Parar de compartilhar" button are visible

#### Scenario: Patient sees shared screen
- **WHEN** the psychologist shares their screen
- **THEN** the patient's main video area switches to the shared screen content
