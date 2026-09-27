-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_user_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_from_routine_id_fkey";

-- DropIndex
DROP INDEX "tasks_user_id_from_routine_id_status_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "from_routine_id";

-- DropTable
DROP TABLE "conversations";

-- DropTable
DROP TABLE "daily_usage";

-- DropTable
DROP TABLE "messages";

