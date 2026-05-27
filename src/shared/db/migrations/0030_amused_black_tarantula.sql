CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);

-- RLS: infrastructure table, service_role only.
-- End-users have no policies and are blocked by default.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role can select rate_limits" ON rate_limits
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY "service_role can insert rate_limits" ON rate_limits
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY "service_role can update rate_limits" ON rate_limits
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role can delete rate_limits" ON rate_limits
  FOR DELETE TO service_role
  USING (true);
