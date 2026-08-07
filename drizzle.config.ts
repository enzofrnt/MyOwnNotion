import { defineConfig } from "drizzle-kit";

/**
 * Drizzle configuration (T013): typed schema in packages/database, SQL
 * migration artifacts generated for review into packages/database/migrations.
 * Migrations are applied explicitly by scripts/db/migrate.ts — never pushed.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/database/src/schema/index.ts",
  out: "./packages/database/migrations",
  casing: "snake_case",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion",
  },
  strict: true,
  verbose: true,
});
