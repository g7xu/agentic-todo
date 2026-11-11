-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "agent_question" TEXT,
ADD COLUMN     "agent_state" TEXT,
ADD COLUMN     "claim_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "claim_id" UUID;

-- CreateTable
CREATE TABLE "task_activities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_activities_task_id_created_at_idx" ON "task_activities"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_activities_user_id_idx" ON "task_activities"("user_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_agent_state_idx" ON "tasks"("user_id", "agent_state");

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The hand-off states and the log's vocabularies (docs/AGENT-TASKS.md). Prisma
-- can't express CHECK constraints, so they live only here.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_state_valid" CHECK ("agent_state" IS NULL OR "agent_state" IN ('suggested', 'ready', 'working', 'needs_input', 'done'));

-- A claim exists exactly while the task is being worked (AT3).
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_claim_only_while_working" CHECK ((COALESCE("agent_state", '') = 'working') = ("claim_id" IS NOT NULL AND "claim_expires_at" IS NOT NULL));

ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_author_valid" CHECK ("author" IN ('agent', 'user'));

ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_kind_valid" CHECK ("kind" IN ('progress', 'question', 'answer', 'report', 'released'));
