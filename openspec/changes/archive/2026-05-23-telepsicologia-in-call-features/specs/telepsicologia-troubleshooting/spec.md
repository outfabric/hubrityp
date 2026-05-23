## ADDED Requirements

### Requirement: Troubleshooting help panel during call
Both psychologist and patient SHALL have access to a "Problema tecnico?" button that opens a popover with numbered troubleshooting steps: (1) check mic/camera browser settings, (2) leave and rejoin, (3) try Chrome or Firefox, (4) contact psychologist via WhatsApp.

#### Scenario: Psychologist opens troubleshooting
- **WHEN** the psychologist clicks "Problema tecnico?"
- **THEN** a popover with 4 troubleshooting steps is displayed

#### Scenario: Patient opens troubleshooting
- **WHEN** the patient clicks "Problema tecnico?"
- **THEN** a popover with troubleshooting steps is displayed, including the psychologist's name in step 4

### Requirement: Quality degradation offers video reduction
When the connection quality indicator shows red (poor), the system SHALL display a warning toast "Sua conexao esta instavel" with an action button "Reduzir qualidade" that lowers the video resolution.

#### Scenario: Poor connection triggers quality reduction offer
- **WHEN** connection quality drops to poor
- **THEN** a warning toast appears with a "Reduzir qualidade" action button

#### Scenario: User accepts quality reduction
- **WHEN** the user clicks "Reduzir qualidade"
- **THEN** the video resolution is lowered to 320x240
