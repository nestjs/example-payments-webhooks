import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** What `db.transaction()` hands its callback. */
export type Transaction = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];
