-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "from_routine_id" UUID;

-- CreateIndex
CREATE INDEX "tasks_user_id_from_routine_id_status_idx" ON "tasks"("user_id", "from_routine_id", "status");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_from_routine_id_fkey" FOREIGN KEY ("from_routine_id") REFERENCES "routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
