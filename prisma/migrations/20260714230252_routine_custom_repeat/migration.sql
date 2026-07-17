-- AlterTable
ALTER TABLE "routines" DROP COLUMN "schedule",
ADD COLUMN     "end_date" DATE,
ADD COLUMN     "repeat_base" TEXT NOT NULL DEFAULT 'scheduled',
ADD COLUMN     "repeat_every" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "repeat_unit" TEXT NOT NULL DEFAULT 'day',
ADD COLUMN     "start_date" DATE NOT NULL DEFAULT CURRENT_DATE;

