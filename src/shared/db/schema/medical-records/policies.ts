// Owner-scoped RLS policies for the medical-records domain tables.
//
// These SQL strings follow the canonical template documented in
// `src/shared/db/migrations/README.md`. They are appended **manually** to
// the Drizzle-generated migration file because Drizzle does not emit RLS.
//
// KEY DIFFERENCE from other domains: NO DELETE policy on any table.
// Lei 13.787/2018 mandates 20-year retention of clinical records — deletion
// is not permitted at any level.

// Owner-scoped RLS for `evolutions`. SELECT/INSERT/UPDATE only.
// The `user_id` column references the psychologist's `auth.users.id`.
export const evolutionsPolicies = [
  `ALTER TABLE evolutions ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select evolutions" ON evolutions
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert evolutions" ON evolutions
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update evolutions" ON evolutions
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;

// JOIN-scoped RLS for `evolution_versions`. SELECT/INSERT only — no UPDATE or
// DELETE. Version snapshots are immutable per Lei 13.787/2018: once a version
// is written, it must never be modified or removed.
// Ownership is derived via the parent `evolutions` row:
//   evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid())
export const evolutionVersionsPolicies = [
  `ALTER TABLE evolution_versions ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select evolution_versions" ON evolution_versions
     FOR SELECT TO authenticated
     USING (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));`,
  `CREATE POLICY "owner can insert evolution_versions" ON evolution_versions
     FOR INSERT TO authenticated
     WITH CHECK (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));`,
] as const;

// Restricted RLS for `audit_log`. SELECT only for authenticated users (own
// entries). No INSERT/UPDATE/DELETE — service-role writes the immutable trail.
export const auditLogPolicies = [
  `ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "user can select own audit entries" ON audit_log
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

// Owner-scoped RLS for `diagnostic_hypotheses`. SELECT/INSERT/UPDATE only.
// NO DELETE policy — Lei 13.787/2018 mandates retention; "discard" is a
// status transition, not a hard delete. The `user_id` column references the
// psychologist's `auth.users.id` directly for RLS simplicity (no subquery).
export const diagnosticHypothesesPolicies = [
  `ALTER TABLE diagnostic_hypotheses ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select diagnostic_hypotheses" ON diagnostic_hypotheses
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert diagnostic_hypotheses" ON diagnostic_hypotheses
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update diagnostic_hypotheses" ON diagnostic_hypotheses
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;

// Owner-scoped RLS for `treatment_plans`. SELECT/INSERT/UPDATE only.
// NO DELETE policy — Lei 13.787/2018 mandates 20-year clinical record retention.
// The `user_id` column references the psychologist's `auth.users.id`.
export const treatmentPlansPolicies = [
  `ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select treatment_plans" ON treatment_plans
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert treatment_plans" ON treatment_plans
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update treatment_plans" ON treatment_plans
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;

// JOIN-scoped RLS for `treatment_plan_versions`. SELECT/INSERT only — no UPDATE or
// DELETE. Version snapshots are immutable per Lei 13.787/2018: once a version
// is written, it must never be modified or removed.
// Ownership is derived via the parent `treatment_plans` row:
//   plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid())
export const treatmentPlanVersionsPolicies = [
  `ALTER TABLE treatment_plan_versions ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select treatment_plan_versions" ON treatment_plan_versions
     FOR SELECT TO authenticated
     USING (plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid()));`,
  `CREATE POLICY "owner can insert treatment_plan_versions" ON treatment_plan_versions
     FOR INSERT TO authenticated
     WITH CHECK (plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid()));`,
] as const;

// Owner-scoped RLS for `scale_applications`. SELECT/INSERT/UPDATE only.
// NO DELETE policy — Lei 13.787/2018 mandates 20-year clinical record retention.
// The `user_id` column references the psychologist's `auth.users.id`.
export const scaleApplicationsPolicies = [
  `ALTER TABLE scale_applications ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select scale_applications" ON scale_applications
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert scale_applications" ON scale_applications
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update scale_applications" ON scale_applications
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;

// Owner-scoped RLS for `evolution_attachments`. SELECT/INSERT/UPDATE only.
// NO DELETE policy — Lei 13.787/2018 mandates 20-year retention; "deletion"
// is a soft-delete (UPDATE setting `deleted_at`), never a physical DELETE.
// The `user_id` column references the psychologist's `auth.users.id`.
export const evolutionAttachmentsPolicies = [
  `ALTER TABLE evolution_attachments ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select attachments" ON evolution_attachments
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert attachments" ON evolution_attachments
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update attachments" ON evolution_attachments
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;

// Owner-scoped RLS for `personal_notes`. SELECT/INSERT/UPDATE only.
// NO DELETE policy — Lei 13.787/2018 mandates retention; personal notes
// are never hard-deleted. The `user_id` column references the
// psychologist's `auth.users.id`.
export const personalNotesPolicies = [
  `ALTER TABLE personal_notes ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select personal_notes" ON personal_notes
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert personal_notes" ON personal_notes
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update personal_notes" ON personal_notes
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;
