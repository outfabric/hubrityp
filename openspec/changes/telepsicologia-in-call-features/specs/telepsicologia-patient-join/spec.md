## MODIFIED Requirements

### Requirement: Patient in-call view includes chat and troubleshooting
The patient's in-call view SHALL include a chat drawer toggle button and a "Problema tecnico?" troubleshooting button, in addition to mic, camera, and leave controls.

#### Scenario: Patient accesses chat during call
- **WHEN** the patient clicks the chat toggle
- **THEN** the chat drawer opens, allowing the patient to send and receive messages

#### Scenario: Patient accesses troubleshooting
- **WHEN** the patient clicks "Problema tecnico?"
- **THEN** a popover with troubleshooting steps is displayed
