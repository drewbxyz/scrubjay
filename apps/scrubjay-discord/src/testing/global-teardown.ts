import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const globalWithContainer = globalThis as typeof globalThis & {
  __PG_CONTAINER__?: StartedPostgreSqlContainer;
};

export default async function globalTeardown() {
  await globalWithContainer.__PG_CONTAINER__?.stop();
}
