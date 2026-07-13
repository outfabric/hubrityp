# WhatsApp Platform Template Contract (pre-deploy checklist)

The platform owns four fixed WhatsApp reminder templates registered in its Twilio WABA
(shared-number MVP). Each template is defined in Twilio's **Content Template Builder** with a
fixed set of **named** variables, and the code contract that feeds those variables lives in
exactly one module:

```
src/modules/whatsapp/lib/reminders/platform-template-contract.ts
```

Named keys are the failure mode. If the keys the code emits drift from the template's declared
variables, Twilio rejects the send with **error 63028** (`Content variables do not match the
template`). Those rejections surface as `failed` `whatsapp_messages` rows via the status webhook
and the reconciliation poller — silently, from the psychologist's perspective the reminder just
never arrives. Keeping the contract file and the Twilio console in lockstep is therefore a
release gate, not a nice-to-have.

## The contract

The code contract (`PLATFORM_TEMPLATE_CONTRACT`) MUST mirror, per template, both the **variable
names** and their **order** as declared in the Content Template Builder:

| Template key         | `serverEnv` Content SID                 | Named variables (in order)                                        |
| -------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| `lembrete_24h`       | `TWILIO_CONTENT_SID_LEMBRETE_24H`       | `first_name`, `professional_name`, `date`, `time`                 |
| `lembrete_2h`        | `TWILIO_CONTENT_SID_LEMBRETE_2H`        | `first_name`, `professional_name`, `time`                         |
| `link_video`         | `TWILIO_CONTENT_SID_LINK_VIDEO`         | `first_name`, `professional_name`, `date`, `time`, `session_link` |
| `cancelamento_aviso` | `TWILIO_CONTENT_SID_CANCELAMENTO_AVISO` | `first_name`, `professional_name`, `date`, `time`                 |

> If you change a template's variables in the Twilio console, update the contract file in the
> same PR (and vice versa). The two are a single source of truth split across two systems — they
> can only be kept honest by hand, because Twilio has no build-time link back to the code.

## Pre-deploy checklist

Run before every deploy that touches WhatsApp reminders, the contract file, or the Twilio WABA
templates. Perform against the **target environment's** Twilio project (staging vs. production
have separate SIDs).

- [ ] **Compare contract vs. console.** For each of the four templates, open its definition in
      Twilio's Content Template Builder and confirm the declared variable names and order match
      `PLATFORM_TEMPLATE_CONTRACT` in `platform-template-contract.ts` exactly. A mismatch is a
      guaranteed 63028 on the first send.
- [ ] **Confirm the four Content SIDs.** Verify that `TWILIO_CONTENT_SID_LEMBRETE_24H`,
      `TWILIO_CONTENT_SID_LEMBRETE_2H`, `TWILIO_CONTENT_SID_LINK_VIDEO`, and
      `TWILIO_CONTENT_SID_CANCELAMENTO_AVISO` are set in the target environment (Vercel env vars
      for staging/production) and that each value is the SID of the corresponding **approved**
      template in that environment's Twilio project. These are boot-validated by `serverEnv`
      (each `z.string().min(1)`), so an empty value fails startup — but a _wrong-but-present_
      SID passes boot and only fails at send time. Confirm the value, not just its presence.
- [ ] **Verify template copy carries the LGPD/PARAR disclosure.** The runtime consent footer
      applies **only to free-form outbound messages** (the confirmation ack and inbox replies) —
      see design **D9**. Twilio ignores the `body` parameter when a `contentSid` is present, so
      a footer can never be appended to a template send at runtime. Any disclosure text required
      on the reminder templates MUST therefore be baked into the Meta-approved Content template
      copy itself. For each of the four templates, confirm the registered copy includes the
      required disclosure equivalent to the free-form footer:
      _"Você está recebendo essa mensagem via WhatsApp. Dados tratados conforme nossa Política de
      Privacidade. Para parar de receber, responda PARAR."_
      Because template copy is immutable once approved, fixing a missing disclosure means
      submitting a new template version to Meta and re-approving — plan for the approval lead
      time, do not block the deploy on a same-day change.

## If a template send fails

- **Error 63028** (`whatsapp_messages` row `failed`, status webhook / reconciliation poller):
  variable-key mismatch. Re-run the "compare contract vs. console" step for the affected
  template key.
- **Error 92007**: a variable value contained a newline. The contract already strips newlines
  (`sanitizeValue`); if this appears, a send path is bypassing `buildContentVariables` — treat as
  a code bug, not a template config issue.
