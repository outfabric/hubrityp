## MODIFIED Requirements

### Requirement: Video link template variable is populated from video_rooms
The `selectTemplateVariables` function SHALL populate the `link_video` variable by querying `video_rooms` for the session when the template kind involves a video link or the session modality is 'online'. If no room exists yet, `link_video` SHALL be an empty string.

#### Scenario: Video room exists for online session
- **WHEN** selectTemplateVariables is called for an online session with a video room
- **THEN** the `link_video` variable contains the patient video URL in the format `https://<domain>/v/<patient_token>`

#### Scenario: No video room exists yet
- **WHEN** selectTemplateVariables is called for an online session without a video room
- **THEN** the `link_video` variable is an empty string
