-- AlterTable
ALTER TABLE "routines" ADD COLUMN     "repeat_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
