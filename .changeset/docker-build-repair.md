---
"scrubjay-discord": patch
---

Repair the Docker build: put pnpm 11's global bin dir (`$PNPM_HOME/bin`) on PATH so the base-stage turbo install succeeds, and point CMD at `dist/main.js` (output flattened when tsconfig gained an explicit `include: ["src/**/*"]`).
