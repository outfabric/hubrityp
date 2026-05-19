---
name: prontuario-nav-architecture
description: Patient detail page vs prontuario page have separate tab systems — patient detail tabs are mostly placeholders while prontuario page has functional tabs
metadata:
  type: project
---

The patient detail page (`/pacientes/[id]`) uses `PatientTabs` component with tabs: Visao geral, Historico de sessoes, Prontuario, Anamnese, Documentos, Financeiro. Of these, only Visao geral and Anamnese are functional; the rest show "Em breve" placeholder.

The actual prontuario lives at `/pacientes/[id]/prontuario` using `ProntuarioTabs` component with 7 functional tabs: Evolucoes, Hipoteses, Plano, Escalas, Documentos, Anexos, Notas. All are functional including a lazy-loaded `DocumentsTab`.

**Why:** This dual-tab architecture means features like Documentos exist in the prontuario sub-page but NOT in the patient detail page's placeholder tab. Users navigating to `/pacientes/[id]` and clicking "Documentos" see "Em breve" even though the feature works at `/pacientes/[id]/prontuario`.

**How to apply:** When testing prontuario-related features (evolutions, hypotheses, documents, attachments, notes), always navigate to `/pacientes/[id]/prontuario`, not to the patient detail page. The patient detail "Documentos" and "Prontuario" tabs being placeholders is a known architecture gap, not a bug in any specific feature.
