/**
 * Cloudflare Worker entry (PLAN.md §1.43). Hyperdrive supplies a pooled
 * MariaDB-compatible connection; each short operation uses one mysql2
 * connection, as recommended by Cloudflare.
 */

import { createConnection } from "mysql2/promise";
import { handleWebhook, type Env, type Query } from "./handler";
import { queryOnConnection } from "./mysql";
import { runScheduledNudge } from "./nudge";

function queryFor(env: Env): Query {
  return async (text, params) => {
    const hyperdrive = env.HYPERDRIVE;
    if (!hyperdrive) throw new Error("HYPERDRIVE binding is not configured.");
    const connection = await createConnection({
      host: hyperdrive.host,
      user: hyperdrive.user,
      password: hyperdrive.password,
      database: hyperdrive.database,
      port: hyperdrive.port,
      charset: "utf8mb4",
      timezone: "Z",
      disableEval: true,
    });
    try {
      return await queryOnConnection(connection)(text, params);
    } finally {
      await connection.end();
    }
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.HYPERDRIVE) return new Response("HYPERDRIVE binding is not configured", { status: 500 });
    return handleWebhook(request, env, queryFor(env));
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (!env.HYPERDRIVE) {
      console.error("learn nudge: HYPERDRIVE binding is not configured");
      return;
    }
    const result = await runScheduledNudge(env, queryFor(env));
    if (result.status === "failed") console.error(`learn nudge: ${result.error}`);
    else console.log(`learn nudge: ${result.status}`);
  },
};
