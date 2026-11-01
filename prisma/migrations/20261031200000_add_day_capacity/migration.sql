-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "daily_capacity" INTEGER;

-- CreateTable
CREATE TABLE "day_capacities" (
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "day_capacities_pkey" PRIMARY KEY ("user_id","date")
);

-- AddForeignKey
ALTER TABLE "day_capacities" ADD CONSTRAINT "day_capacities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

