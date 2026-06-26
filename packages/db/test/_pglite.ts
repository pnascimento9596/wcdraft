import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/schema/index.ts";

type MigratedPglite = {
  client: PGlite;
};

export async function withMigratedPglite<T>(fn: (ctx: MigratedPglite) => Promise<T>): Promise<T> {
  const client = await PGlite.create();
  const db = drizzle({ client, schema });

  await migrate(db, {
    migrationsFolder: new URL("../migrations", import.meta.url).pathname,
  });

  try {
    return await fn({ client });
  } finally {
    await client.close();
  }
}
