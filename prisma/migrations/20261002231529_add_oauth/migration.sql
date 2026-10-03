-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "redirect_uris" TEXT[],
    "document" JSONB,
    "fetched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "resource" TEXT,
    "grant_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_codes_code_hash_key" ON "oauth_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_codes_expires_at_idx" ON "oauth_codes"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_token_hash_key" ON "oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_tokens_grant_id_idx" ON "oauth_tokens"("grant_id");

-- CreateIndex
CREATE INDEX "oauth_tokens_expires_at_idx" ON "oauth_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
