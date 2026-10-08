import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createConnection } from "mysql2/promise";
import { databaseOptions } from "./driver";
const connection = await createConnection(databaseOptions(process.env.DATABASE_URL));
try {
  await connection.query("SET time_zone = '+00:00'");
  await migrate(drizzle(connection), { migrationsFolder: "./drizzle-mysql" });
  console.log(
    "MariaDB migrations applied. Seed separately after reviewing brand/owner configuration.",
  );
} finally {
  await connection.end();
}
