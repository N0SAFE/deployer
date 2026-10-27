# OpenAPI and API reference

The BFF publishes the OpenAPI document of the whole composed API (every service's contract), built
from `appContract` so it describes only what this process mounts.

- Spec: `GET /openapi.json` (public; it exposes shape, never data. Procedures still enforce their
  own auth when called).
- Readable page: `GET /reference` (lists every operation from the spec; the web devtools iframe
  points at it).
- Offline, without running the server:

  ```bash
  cd apps/api/bff
  bun run openapi:generate > openapi.json
  ```

  The script and the endpoint share `generateOpenApiSpec()` (`src/orpc/openapi.ts`), so a file
  written offline cannot differ from what the running BFF serves.

Notes:

- The relative server URL (`/`) keeps links valid when the API sits behind a rewrite or proxy.
- A procedure meant only for a peer service (such as `deployment.triggerFromEvent`) is currently in
  the document too; see `ARCH-109` in `docs/audit-2026-10-25/roadmap/architecture.md`.
