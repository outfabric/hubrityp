# CI — Required jobs and branch protection

The CI workflow (`.github/workflows/ci.yml`) defines four jobs:

| Job           | Depends on | Purpose                                                                                     |
| ------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `quality`     | —          | Lint, typecheck, format check, and unit tests.                                              |
| `integration` | `quality`  | Vitest integration suite against Testcontainers Postgres.                                   |
| `e2e`         | `quality`  | Default Playwright suite against Testcontainers + mock GoTrue.                              |
| `e2e-real`    | `e2e`      | `@auth-real` Playwright suite against the real Supabase stack started via `supabase start`. |

## Required status checks for `main`

Branch protection on `main` MUST include all four jobs as required status checks. In particular, **`e2e-real` MUST be configured as a required check** — otherwise a PR with a failing `e2e-real` can be merged because only the upstream gates (`quality`, `integration`, `e2e`) would block it.

This is a manual GitHub configuration step. It cannot be set from inside the repo. Configure it in the GitHub UI under:

`Settings` → `Branches` → `Branch protection rules` → `main` → `Require status checks to pass before merging` → check each of `quality`, `integration`, `e2e`, `e2e-real`.

Equivalent `gh` invocation (run by a repo admin):

```bash
gh api -X PUT "repos/:owner/:repo/branches/main/protection" \
  -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]=quality \
  -F required_status_checks.contexts[]=integration \
  -F required_status_checks.contexts[]=e2e \
  -F required_status_checks.contexts[]=e2e-real \
  -F enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F restrictions=
```

Until `e2e-real` is added to the list, a red `e2e-real` does not block merging. Audit the protection rule whenever a new required job is introduced.
