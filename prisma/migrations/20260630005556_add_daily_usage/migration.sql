-- CreateTable
CREATE TABLE "daily_usage" (
    "user_id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_usage_pkey" PRIMARY KEY ("user_id","day")
);
