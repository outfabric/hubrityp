# telepsicologia-troubleshooting Specification

## Purpose

In-call troubleshooting support for telepsychology: help panel with numbered steps for both psychologist and patient, connection quality monitoring with adaptive video resolution reduction offer.

## Requirements

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

### Requirement: Client-side call.join errors are logged with details
When `call.join()` fails in the psychologist's pre-call lobby or the patient's in-call view, the actual error from the Stream SDK SHALL be logged via `console.error` with a `[telepsicologia]` prefix. The error SHALL NOT be swallowed. The user-facing error message SHALL remain generic (no raw error details exposed to the UI).

#### Scenario: Psychologist join failure is logged
- **WHEN** `call.join()` rejects in the pre-call lobby
- **THEN** `console.error('[telepsicologia] call.join failed', error)` is called with the actual Stream error, and the generic error message is shown to the user

#### Scenario: Patient join failure is logged
- **WHEN** `call.join()` rejects in the patient in-call view
- **THEN** `console.error('[telepsicologia] call.join failed', error)` is called with the actual Stream error
