#!/bin/sh
set -e
node scripts/migrate.mjs
if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  exec node --import ./otel/instrumentation.mjs .output/server/index.mjs
fi
exec node .output/server/index.mjs
