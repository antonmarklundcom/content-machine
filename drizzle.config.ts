import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { resolveDriver } from "./src/db/driver";
const url = process.env.DATABASE_URL ?? "";
if (url) resolveDriver(url);
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle-mysql",
  dialect: "mysql",
  dbCredentials: { url },
});
