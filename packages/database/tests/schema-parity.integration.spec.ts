import { schema } from "@myownnotion/database";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { createIntegrationContext } from "./helpers/db.ts";

it("keeps declared column and foreign-key contracts consistent with a fully migrated database", async () => {
  const context = await createIntegrationContext();
  try {
    const columns = await context.handle.db.execute<{
      table_name: string;
      column_name: string;
      sql_type: string;
      not_null: boolean;
    }>(sql`
      SELECT c.relname AS table_name, a.attname AS column_name,
        format_type(a.atttypid, a.atttypmod) AS sql_type, a.attnotnull AS not_null
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND a.attnum > 0 AND NOT a.attisdropped
    `);
    const foreignKeys = await context.handle.db.execute<{
      table_name: string;
      column_names: string[];
      target_table: string;
      target_columns: string[];
    }>(sql`
      SELECT c.relname AS table_name, f.relname AS target_table,
        ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(num, ord)
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.num ORDER BY ord)
          AS column_names,
        ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(num, ord)
          JOIN pg_attribute a ON a.attrelid = f.oid AND a.attnum = x.num ORDER BY ord)
          AS target_columns
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_class f ON f.oid = k.confrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND k.contype = 'f'
    `);
    const failures: string[] = [];
    const tables = Object.values(schema).filter((value) => is(value, PgTable));
    expect(tables.length).toBeGreaterThan(40);
    for (const table of tables) {
      const config = getTableConfig(table);
      const primaryColumns = new Set(config.primaryKeys.flatMap((key) => key.columns));
      for (const column of config.columns) {
        const actual = columns.rows.find(
          (row) => row.table_name === config.name && row.column_name === column.name,
        );
        const expectedType = column.getSQLType();
        if (actual === undefined) failures.push(`${config.name}.${column.name}: missing column`);
        else {
          if (actual.sql_type !== expectedType)
            failures.push(
              `${config.name}.${column.name}: type ${actual.sql_type} != ${expectedType}`,
            );
          if (actual.not_null !== (column.notNull || column.primary || primaryColumns.has(column)))
            failures.push(`${config.name}.${column.name}: nullability differs`);
        }
      }
      for (const key of config.foreignKeys) {
        const reference = key.reference();
        const expected = {
          table_name: config.name,
          column_names: reference.columns.map((column) => column.name),
          target_table: getTableConfig(reference.foreignTable).name,
          target_columns: reference.foreignColumns.map((column) => column.name),
        };
        const found = foreignKeys.rows.some(
          (actual) =>
            actual.table_name === expected.table_name &&
            actual.target_table === expected.target_table &&
            actual.column_names.join() === expected.column_names.join() &&
            actual.target_columns.join() === expected.target_columns.join(),
        );
        if (!found)
          failures.push(`${config.name}: missing foreign key ${expected.column_names.join()}`);
      }
    }
    expect(failures).toEqual([]);
  } finally {
    await context.close();
  }
});
