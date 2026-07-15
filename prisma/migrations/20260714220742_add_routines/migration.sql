-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "routine_id" UUID;

-- CreateTable
CREATE TABLE "routines" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "priority" SMALLINT NOT NULL DEFAULT 4,
    "schedule" TEXT NOT NULL DEFAULT 'daily',
    "on_miss" TEXT NOT NULL DEFAULT 'skip',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routines_user_id_active_idx" ON "routines"("user_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_routine_id_due_date_key" ON "tasks"("routine_id", "due_date");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

