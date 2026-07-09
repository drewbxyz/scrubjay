import { Inject, Injectable } from "@nestjs/common";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./drizzle.schema";
import { PG_CONNECTION } from "./pg-connection";

export type Db = NodePgDatabase<typeof schema>;

/** The transaction handle drizzle passes into a `db.transaction(async (tx) => ...)` callback. */
export type Tx = Parameters<Db["transaction"]>[0] extends (
  tx: infer T,
) => Promise<unknown>
  ? T
  : never;

/** Accepted by repository methods that must compose with a caller-owned transaction. */
export type DbOrTx = Db | Tx;

@Injectable()
export class DrizzleService {
  constructor(@Inject(PG_CONNECTION) readonly db: Db) {}
}
