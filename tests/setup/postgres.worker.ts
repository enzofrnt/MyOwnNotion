import { inject } from "vitest";

// startDisposablePostgres() sees this URL and creates a unique database on the
// project server instead of starting another PostgreSQL container per file.
process.env["TEST_DATABASE_URL"] = inject("testDatabaseServerUrl");
