---
name: diacritics-qa-scope
description: Where ptbr-diacritics regressions hide — settings H1s vs breadcrumb label map, and the scale metadata-vs-items split (items deferred to clinical review, metadata in-scope)
metadata:
  type: project
---

QA of the `correct-ptbr-diacritics` change (worktree `/home/ubuntu/repos/hubrityp-correct-ptbr-diacritics`, branch off main). A repo-wide diacritic/cedilla fix to user-facing display copy.

**Two regression hotspots found (both MÉDIO, qa-1 2026-06-07):**
1. **Settings page H1s drift from the breadcrumb.** Breadcrumb labels come from a CORRECT map `src/app/(app)/configuracoes/breadcrumb-labels.ts` ("Configurações", "Integrações", "Histórico", "Transcrição IA", "Notificações"), but each settings sub-page hard-codes its OWN H1 in `page.tsx`. Two were missed: `configuracoes/agenda/page.tsx:38` and `configuracoes/lembretes/page.tsx:38` render bare "Configuracoes da Agenda"/"Configuracoes de Lembretes" while the breadcrumb above says "Configurações". **Always diff the H1 against the breadcrumb on each `/configuracoes/*` sub-page** — they have independent sources. notificacoes/transcricao-ia/feedback/index H1s were correct.
2. **Clinical-scale METADATA vs ITEMS split.** `src/modules/medical-records/lib/scales/*.ts` carry a `TODO(clinical-review): … only unambiguous diacritics added here` marker — verbatim instrument item wording is INTENTIONALLY deferred to clinical review (don't flag bare words inside the numbered questions). BUT the scale `label`, `description`, and severity-classification `label` are the app's OWN unambiguous UI copy and were missed: "PHQ-9 (Depressao)", "AUDIT (Uso de Alcool)"/"problematico de alcool", SDQ "Versao autoaplicavel", WHOQOL "avaliacao…quatro dominios: fisico, psicologico, relacoes", severity "Minimo"→"Mínimo". These surface in the Escalas picker, apply-mode step, application header (`scaleName={scale.label}`), and result badge (`classification.label`, scale-application-form.tsx:274). PHQ-9 item questions themselves were already correctly accented.

**Reusable bare-word scanner** (negative test, run via `playwright-cli --raw eval`): regex whole-word match of `nao|sessao|configuracao|voce|codigo|historico|analise|evolucao|consultorio|psicologico|declaracao|relatorio|observacao|endereco|proximo|comecar|disponivel|obrigatorio|minimo|maximo` against `document.body.innerText`. False positives to ignore: "Telefone" (no diacritic needed). It does NOT catch placeholders/aria — also dump `querySelectorAll('input,textarea').placeholder` and `querySelectorAll('label').innerText`.

**Document-type label map (Scenario 2) was CORRECT:** `/pacientes/{id}/prontuario/documentos/novo` shows "Declaração/Atestado/Relatório/Laudo/Parecer Psicológico" properly. Route segments (Scenario 3) all resolve un-accented.

See [[authenticated-browser-qa-setup]] for the cookie-injection login (this worktree's container is `hubrityp-correct-ptbr-diacritics-app-1`, NEXT_PUBLIC_SUPABASE_URL = internal `supabase_kong_hubrityp:8000` so cookie name = `sb-supabase_kong_hubrityp-auth-token`). To reach prontuário: insert a patient directly — `INSERT INTO public.patients (user_id, full_name, patient_type, status) VALUES (<owner>, '…', 'adult', 'active')`.
