# agenda-locations Specification

## Purpose

Manage psychologist attendance locations (in-person, online, other) used to associate where sessions take place. Locations are owner-scoped and support a single default per psychologist.

## Requirements

### Requirement: Psychologist can create an attendance location

The system SHALL allow the psychologist to create attendance locations with name, address, type (in_person/online/other), optional color, and optional arrival instructions. Each location belongs to a single psychologist (owner-scoped via `user_id`).

#### Scenario: Create a new in-person location

- **WHEN** psychologist fills the location form with name "Consultorio Vila Mariana", address "Rua Domingos de Morais, 2564", type "in_person", and clicks "Salvar"
- **THEN** system creates the location and it appears in the locations list

#### Scenario: Create an online location

- **WHEN** psychologist creates a location with name "Online", type "online", no address
- **THEN** system creates the location; address is optional for online locations

#### Scenario: Create location with arrival instructions

- **WHEN** psychologist fills arrival_instructions with "Predio cinza, interfone 42, 3o andar"
- **THEN** the instructions are stored and shown in the location detail

### Requirement: Psychologist can list their attendance locations

The system SHALL display all locations belonging to the authenticated psychologist, showing name, type badge, address, color dot, and default indicator.

#### Scenario: List locations

- **WHEN** psychologist navigates to Configuracoes > Locais de Atendimento
- **THEN** system displays all their locations as interactive cards with name, type, address, and default badge

#### Scenario: Empty state when no locations exist

- **WHEN** psychologist has no locations registered
- **THEN** system shows empty state with Building2 icon, "Nenhum local cadastrado" heading, and "Adicionar local" CTA button

### Requirement: Psychologist can edit an attendance location

The system SHALL allow the psychologist to edit any of their own locations. All fields are editable.

#### Scenario: Edit location name

- **WHEN** psychologist changes location name from "Consultorio" to "Consultorio Centro" and saves
- **THEN** the updated name is persisted and reflected in the list

### Requirement: Psychologist can delete an attendance location

The system SHALL allow the psychologist to delete a location that is not referenced by any session. Deletion requires confirmation via AlertDialog.

#### Scenario: Delete unreferenced location

- **WHEN** psychologist clicks delete on a location with no linked sessions and confirms
- **THEN** the location is permanently removed from the database

#### Scenario: Attempt to delete location with linked sessions

- **WHEN** psychologist tries to delete a location that is referenced by at least one session
- **THEN** system shows error "Este local esta vinculado a sessoes. Remova o vinculo antes de excluir."

### Requirement: Psychologist can mark a location as default

The system SHALL allow exactly one location per psychologist to be marked as default. The default location is pre-selected when creating new sessions.

#### Scenario: Set location as default

- **WHEN** psychologist clicks "Marcar como padrao" on a location
- **THEN** that location becomes the default, and any previously default location loses its default status

#### Scenario: Default location pre-selects in session form

- **WHEN** psychologist opens the session creation form and has a default location
- **THEN** the location field is pre-populated with the default location

### Requirement: RLS enforces owner-scoped access on locations table

The system SHALL enable RLS on `locations` using `user_id = auth.uid()`. A psychologist can only see, create, update, and delete their own locations.

#### Scenario: Cross-psychologist access is blocked

- **WHEN** psychologist A queries the locations table
- **THEN** only locations belonging to psychologist A are returned; psychologist B's locations are invisible
