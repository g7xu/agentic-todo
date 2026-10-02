-- A routine's pending work is computed from its cadence, so no routine row may
-- be 'active'. Rows whose day has certainly passed become the miss they stand
-- for; the rest are removed.
--
-- CURRENT_DATE is the database's UTC day, which can be a day ahead of or behind
-- the owner's local day. Only rows dated before yesterday-UTC are in the past in
-- every timezone.
UPDATE "tasks"
SET "status" = 'missed', "completed_at" = NULL
WHERE "routine_id" IS NOT NULL
  AND "status" = 'active'
  AND "due_date" < CURRENT_DATE - 1;

DELETE FROM "tasks"
WHERE "routine_id" IS NOT NULL
  AND "status" = 'active';
