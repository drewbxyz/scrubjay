/**
 * instrumentation-pg derives `db.client.connection.pool.name` from a Pool's
 * `host`/`port`/`database` *options*. A Pool built from only a
 * `connectionString` leaves those undefined, so the metric labels come back as
 * "unknown_host:unknown_port/unknown_database". Parsing the URL and passing the
 * fields explicitly fixes the label — pg re-parses the connectionString over
 * these at connect time, so they feed the metric name only, not the real
 * connection.
 */
export function poolNameFields(databaseUrl: string): {
  host: string;
  port: number;
  database: string;
} {
  const url = new URL(databaseUrl);
  return {
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
  };
}
