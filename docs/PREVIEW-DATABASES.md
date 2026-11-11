# A database per preview

Every Vercel preview deployment runs `npm run build`, and the build applies
pending migrations (`scripts/migrate-on-deploy.mjs`). Today all previews share
one database: the Neon `development` branch that the Preview-scoped
`DATABASE_URL` and `DIRECT_URL` point at. A broken migration on one pull request
is recorded there as failed, and Prisma then refuses to migrate that database
again, so every other preview breaks too until someone clears the record by
hand. That happened on PR #65.

Neon's Vercel integration fixes that by giving each preview its own Neon branch,
`preview/<git-branch>`, made from a parent branch when the preview deploys. A bad
migration then breaks only its own preview, and deleting that branch clears it.

Two other safeguards cover the same failure and need no setup:

- **Quiet dotenv.** `prisma.config.ts` and `scripts/migrate-on-deploy.mjs` load
  `.env.local` with `quiet: true`, so dotenv's banner can't be captured into a
  file such as a generated `migration.sql`.
- **CI.** `.github/workflows/migrations.yml` checks that every `migration.sql`
  is SQL (`npm run db:check`), applies all migrations to a fresh Postgres, and
  checks the result matches `prisma/schema.prisma`, on every pull request that
  touches migrations.

## What the code already handles

The integration sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`
(direct) for each preview. It does not set `DIRECT_URL`. Prisma's CLI and the
deploy script therefore read the first of these that is set:

1. `DIRECT_URL`
2. `DATABASE_URL_UNPOOLED`
3. `DATABASE_URL`

The runtime (`src/lib/db.ts`) reads `DATABASE_URL`, unchanged.

So once the integration is on, **`DIRECT_URL` must not be set for Preview**.
If it is, migrations go to the shared `development` branch while the app reads
the preview's own branch.

## Setup (in the Neon and Vercel dashboards)

This uses the Neon-managed integration, which links an existing Neon project
to an existing Vercel project.

1. **Choose what previews copy.** Preview branches are always made from the
   Neon project's *default* branch. If that is the production branch, every
   preview starts with a copy of production data. To have previews start from
   `development` instead, open Neon Console → your project → Branches, and make
   `development` the default branch. The integration picks the production
   branch separately, in step 4.
2. **Clear the Preview database variables in Vercel.** Vercel → agentic-todo →
   Settings → Environment Variables: delete the Preview-scoped `DATABASE_URL`
   and `DIRECT_URL`, and any `PGHOST`, `PGUSER`, `PGDATABASE` or `PGPASSWORD`.
   The integration fails to install while variables with its names exist. If the
   Production values sit in the same entries as Preview, edit those entries to
   Production only rather than deleting them. Note the values first, so they can
   be put back if you undo this.
3. **Install.** Neon Console → Integrations → Vercel → Add, which opens the
   Vercel Marketplace. Choose Install, then *Link Existing Neon Account*, and
   allow it access to the agentic-todo Vercel project only.
4. **Connect.** In *Integrate Neon*, pick the agentic-todo Vercel project, then
   this Neon project, its **production** branch, the database and the role.
   Turn on *Automatically delete obsolete Neon branches*, so a preview's branch
   goes when its git branch is merged or deleted. Leave *Create a branch for
   your development environment* off, since `.env.local` already points at
   `development`. Choose Connect.
5. **Check Production is untouched.** Back in Vercel's Environment Variables,
   the Production `DATABASE_URL` and `DIRECT_URL` should still point at the
   production branch. If the integration added a Production `DATABASE_URL`, it
   should match the existing one.
6. **Check a preview.** Push any branch, or redeploy a pull request. Its build
   log should show `prisma migrate deploy` applying migrations, and Neon should
   list a new `preview/<branch>` branch. Sign in on the preview to confirm auth
   works.

## Sign-in on previews

`NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` stay as they are for Preview.
If the integration is set to manage Neon Auth, it sets `NEON_AUTH_BASE_URL` per
preview branch instead, and each preview gets its own users. In that case the
preview's host may need adding under Neon → Auth → Domains before sign-in works
there.

## Until this is set up

Previews keep sharing the `development` branch, as before. If a preview build
fails with Prisma error P3009, a failed migration is recorded there. Clear it
against that branch, for example:

```
npx prisma migrate resolve --rolled-back <migration_name>
```
