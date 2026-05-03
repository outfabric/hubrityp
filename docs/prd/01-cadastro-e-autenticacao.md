# PRD 01 — Cadastro e Autenticação

> **Pré-requisito:** ler PRD 00 antes deste documento.

---

## 1. Contexto e problema

O sistema é um SaaS para psicólogos brasileiros. Antes de usar qualquer funcionalidade, o usuário precisa criar uma conta segura, comprovar que é psicólogo registrado em um Conselho Regional de Psicologia (CRP) e fazer login.

**Por que validar o CRP?** O sistema lida com dados clínicos de pacientes (dados pessoais sensíveis, LGPD art. 11). Permitir cadastro de não-psicólogos seria uma falha grave de segurança, ética e conformidade. Validação inadequada de CRP é um risco direto para a empresa.

## 2. Objetivo da feature

Permitir que um psicólogo brasileiro:
1. Crie uma conta segura com email + senha (e/ou login social).
2. Comprove ser psicólogo via número de CRP.
3. Faça login e mantenha sessão ativa de forma segura.
4. Recupere senha perdida.

## 3. Escopo

### Dentro do escopo
- Cadastro com email + senha
- Login com email + senha
- Login com Google (OAuth)
- Validação de CRP (formato + lookup)
- Recuperação de senha por email
- Logout
- Sessões persistentes ("manter conectado")
- Aceite obrigatório de Termos de Uso e Política de Privacidade
- Verificação de email obrigatória antes de uso pleno
- Bloqueio temporário após tentativas de login falhas

### Fora do escopo (versões futuras)
- Login com Apple ID (avaliar pós-MVP)
- SSO empresarial (não aplica para autônomo)
- Login biométrico mobile (deixar para versão mobile dedicada)
- Multi-conta no mesmo usuário (1 psicólogo = 1 conta)

## 4. User stories

- **Como psicóloga**, quero criar uma conta em menos de 2 minutos para começar a usar o sistema.
- **Como psicóloga**, quero comprovar meu CRP no cadastro para que minha conta seja reconhecida como profissional.
- **Como psicóloga**, quero entrar com Google para não ter que lembrar de mais uma senha.
- **Como psicóloga**, quero recuperar minha senha se esquecer, sem precisar contactar suporte.
- **Como administrador do sistema**, quero impedir que pessoas sem CRP válido criem conta.

## 5. Requisitos funcionais

### 5.1. Tela de cadastro

**RF-01.01.** Formulário com os seguintes campos:
- Nome completo (obrigatório, mín. 3 caracteres, máx. 120)
- Email (obrigatório, validação RFC 5322)
- Senha (obrigatório, mín. 10 caracteres — ver RF-01.04)
- Confirmação de senha (obrigatório, deve ser igual à senha)
- Número de CRP (obrigatório, formato `XX/NNNNNN` onde XX é UF — ver RF-01.05)
- UF do CRP (obrigatório, dropdown com 27 UFs)
- Aceite dos Termos de Uso (checkbox obrigatório)
- Aceite da Política de Privacidade (checkbox obrigatório)
- Aceite do Tratamento de Dados Sensíveis para finalidade de saúde (checkbox separado, obrigatório)

**RF-01.02.** Após submit válido, criar usuário com status `pending_verification` e enviar email de verificação contendo link único válido por 24 horas.

**RF-01.03.** Usuário com `pending_verification` pode fazer login mas só vê tela bloqueante "Verifique seu email". Não pode acessar nenhuma outra funcionalidade até verificar.

**RF-01.04.** Validação de senha:
- Mínimo 10 caracteres
- Pelo menos 1 letra maiúscula
- Pelo menos 1 letra minúscula
- Pelo menos 1 número
- Pelo menos 1 caractere especial (`!@#$%^&*()_+-=[]{}|;:,.<>?`)

**RF-01.05.** Validação de CRP:
- Formato regex: `^\d{2}/\d{4,7}$` (ex: `06/123456` para São Paulo)
- A primeira parte é o código numérico do CRP regional (01 a 24, ver tabela em Apêndice A)
- A segunda parte é o número de inscrição (4 a 7 dígitos)
- **Obrigatório:** validar via consulta ao site público do CFP (`https://cadastro.cfp.org.br/`) ou serviço equivalente. Se não houver API pública estável, exibir tela manual de validação humana (admin valida em até 24h após recebimento de foto da carteira).

### 5.2. Tela de login

**RF-01.06.** Formulário com:
- Email
- Senha
- Checkbox "Manter conectado" (se marcado, sessão dura 1 dia; se não, dura até fechar o navegador)
- Link "Esqueci minha senha"
- Botão "Entrar com Google"

**RF-01.07.** Após login bem-sucedido, redirecionar para dashboard (rota `/app`).

**RF-01.08.** Bloqueio por tentativas:
- 5 tentativas falhas em 15 minutos → bloquear conta por 30 minutos
- Notificar usuário por email a cada bloqueio
- Após 3 bloqueios consecutivos → exigir verificação adicional (email + reset de senha)

### 5.3. Login social (Google OAuth 2.0)

**RF-01.10.** Suportar OAuth 2.0 com Google.

**RF-01.11.** Se for primeiro acesso via Google, redirecionar para tela de complementar cadastro (CRP, UF, aceites). Conta só fica `active` após complemento.

**RF-01.12.** Se email do Google já existir como conta tradicional, oferecer vincular contas (login deve confirmar senha tradicional uma vez).

### 5.4. Recuperação de senha

**RF-01.13.** Tela com campo email. Ao submeter:
- Sempre retornar mesma mensagem ("Se este email estiver cadastrado, enviaremos um link") para evitar enumeração de emails
- Se email existir, enviar link único válido por 1 hora

**RF-01.14.** Tela de redefinição: nova senha + confirmação. Aplica RF-01.04.

**RF-01.15.** Após redefinir senha, invalidar todas as sessões ativas do usuário e enviar email avisando.

### 5.6. Sessão e logout

**RF-01.20.** Sessão JWT armazenada em cookie `httpOnly`, `secure`, `sameSite=lax`.

**RF-01.21.** Token de acesso com duração curta (15 minutos), token de refresh com duração maior (1 dia se "manter conectado", senão sessão).

**RF-01.22.** Botão "Sair" no menu disponível em todas as páginas autenticadas. Logout invalida o refresh token no backend.

## 6. Requisitos não-funcionais

**RNF-01.01.** Senhas devem ser armazenadas com **bcrypt cost ≥ 12** ou **Argon2id** com parâmetros recomendados (OWASP).

**RNF-01.02.** Tempo de resposta:
- Cadastro: < 2 segundos (excluindo envio de email, que é assíncrono)
- Login: < 1 segundo
- Validação de CRP: pode ser assíncrona se a fonte externa for lenta — aceitar cadastro com status `pending_crp_validation` e validar em background

**RNF-01.03.** Disponibilidade alvo: 99,5% (downtime máximo 3,6 horas/mês).

**RNF-01.04.** Dados em trânsito: TLS 1.3 obrigatório. Rejeitar conexões sem HTTPS.

**RNF-01.05.** Logs de autenticação devem registrar (sem armazenar senha):
- Tentativa de login (sucesso/falha)
- Troca de senha
- Vinculação de conta social
- IP e user-agent
- Logs retidos por 6 meses para auditoria

## 7. Regras de negócio

**RN-01.01.** Um email único = uma conta. Não permitir duplicatas (case-insensitive).

**RN-01.02.** Um CRP único = uma conta. Não permitir duas contas com mesmo CRP/UF.

**RN-01.03.** Status possíveis de conta:
- `pending_verification` — criada, aguardando verificação de email
- `pending_crp_validation` — verificada por email, aguardando validação manual de CRP
- `active` — totalmente operacional
- `suspended` — bloqueada por administrador (ex: denúncia ética)
- `cancelled` — usuário cancelou conta (mantida em soft delete por 30 dias depois é anonimizada — ver PRD 11)

**RN-01.04.** Apenas usuários `active` podem criar pacientes, agendar sessões etc. (ver outros PRDs).

**RN-01.05.** O sistema NÃO armazena foto da carteira do CRP em produção — após validação manual, a foto é deletada e fica apenas o status validado + data + ID do admin que validou.

**RN-01.06.** É proibido o cadastro de pessoa que NÃO é psicóloga registrada. Tentativas detectadas devem gerar bloqueio do email/IP por 24h e log para revisão.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Usuário tenta cadastrar com CRP inválido | Mensagem clara: "CRP não encontrado no cadastro do CFP. Confira o número e UF" |
| Usuário tenta cadastrar com CRP de outra pessoa | Validação humana detecta divergência nome/CRP — bloquear cadastro |
| Email do Google é diferente do email digitado no cadastro | Tratar como conta nova; oferecer fundir contas se desejar |
| Tentativa de cadastro com email já existente | "Este email já está cadastrado. Faça login ou recupere sua senha." (NÃO confirmar se conta existe? Trade-off: usabilidade vs enumeração — neste caso, optar por usabilidade pois email já está exposto) |
| Servidor de email caiu | Retentar 3x com backoff exponencial; após 24h, marcar email como `failed_to_send` e exibir aviso ao usuário no próximo login |
| Conta `cancelled` tenta logar | Mostrar "Esta conta foi cancelada. Para reativar, contacte suporte" |
| CRP do estado mudou (psicólogo migrou) | Permitir alteração de CRP em Configurações com nova validação |

## 9. Critérios de aceitação

- [ ] Cadastro completo em <2 minutos (testar com cronômetro)
- [ ] Senha fraca é rejeitada com mensagem específica do que falta
- [ ] CRP no formato errado é rejeitado antes do submit
- [ ] Email de verificação é recebido em até 30 segundos
- [ ] Link de verificação expirado (>24h) mostra erro claro com opção de reenviar
- [ ] Login com email errado mostra mensagem genérica (não confirma existência)
- [ ] Login com senha errada incrementa contador de tentativas
- [ ] 6ª tentativa em 15 min bloqueia conta e envia email
- [ ] Códigos de recuperação funcionam uma única vez
- [ ] Logout encerra sessão (token de refresh invalidado no backend)
- [ ] Reset de senha invalida todas as sessões ativas
- [ ] Não é possível ter dois usuários com mesmo CRP/UF
- [ ] Tentativa de cadastro com CRP inexistente é bloqueada
- [ ] Logs de autenticação são gravados conforme RNF-01.05
- [ ] Senhas são armazenadas com hash forte (auditar manualmente o banco)

## 10. Dependências

- `Resend`, Provedor de email transacional — necessário para emails de verificação e reset
- Supabase Auth (recomendado)
- Biblioteca TOTP: `otplib` (Node.js)
- API de validação de CRP — se não existir API estável, processo manual com SLA de 24h

## 11. Referências regulatórias

- LGPD Art. 7º (bases legais), Art. 11 (dados sensíveis), Art. 8º (consentimento)
- LGPD Art. 18 (direitos do titular) — dever de permitir exclusão
- Resolução CFP nº 09/2024 — exige psicólogo com inscrição ativa em CRP para atender por meios digitais

## Apêndice A — Códigos dos CRPs regionais

| Código | UF | Estado |
|---|---|---|
| 01 | DF | Distrito Federal |
| 02 | PE | Pernambuco |
| 03 | BA | Bahia / Sergipe |
| 04 | MG | Minas Gerais |
| 05 | RJ | Rio de Janeiro |
| 06 | SP | São Paulo |
| 07 | RS | Rio Grande do Sul |
| 08 | PR | Paraná |
| 09 | GO | Goiás / Tocantins |
| 10 | PA | Pará / Amapá |
| 11 | CE | Ceará / Piauí / Maranhão |
| 12 | SC | Santa Catarina |
| 13 | PB | Paraíba / RN |
| 14 | MS | Mato Grosso do Sul |
| 15 | AL | Alagoas |
| 16 | ES | Espírito Santo |
| 17 | RN | Rio Grande do Norte (separado do PB em 2010) |
| 18 | MT | Mato Grosso |
| 19 | SE | Sergipe (separado da BA) |
| 20 | AM | Amazonas / Roraima / Acre / Rondônia |
| 21 | PI | Piauí |
| 22 | MA | Maranhão |
| 23 | TO | Tocantins |
| 24 | RR | Roraima |

> **Atenção:** esta tabela pode mudar com criação de novos CRPs. Validar contra fonte oficial do CFP no momento da implementação.

## Apêndice B — Modelo de dados sugerido

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified_at TIMESTAMPTZ,
  password_hash VARCHAR(255), -- nullable se for só social login
  full_name VARCHAR(120) NOT NULL,
  crp_number VARCHAR(20) NOT NULL,
  crp_uf CHAR(2) NOT NULL,
  crp_validated_at TIMESTAMPTZ,
  crp_validated_by UUID, -- admin que validou
  status VARCHAR(30) NOT NULL DEFAULT 'pending_verification',
  totp_secret VARCHAR(255), -- criptografado
  totp_enabled BOOLEAN DEFAULT FALSE,
  recovery_codes_hash TEXT[], -- bcrypt de cada código
  terms_accepted_at TIMESTAMPTZ NOT NULL,
  privacy_accepted_at TIMESTAMPTZ NOT NULL,
  sensitive_data_consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (crp_number, crp_uf)
);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL,
  ip INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE auth_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event VARCHAR(50) NOT NULL, -- 'login_success', 'login_fail', 'password_reset', etc.
  ip INET,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_logs_user_event ON auth_logs(user_id, event, created_at DESC);
```