-- Drop the UPDATE policy on `evolution_versions` to enforce immutability at
-- the database layer. Version snapshots must never be modified once written
-- (Lei 13.787/2018 — 20-year retention of unaltered clinical records).
--
-- After this migration, only SELECT and INSERT policies remain on this table.

DROP POLICY IF EXISTS "owner can update evolution_versions" ON "evolution_versions";
