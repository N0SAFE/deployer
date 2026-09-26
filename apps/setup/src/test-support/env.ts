import { EnvService } from "@/config/env/env.module";

/**
 * Build a real `EnvService` for a spec, with the given variables in `process.env`.
 *
 * ── WHY A REAL SERVICE AND NOT A STUB ───────────────────────────────────────
 * Specs that assert on resolved configuration should exercise the actual
 * resolution — the schema's coercion, its defaults, and the subclass's binding
 * to `setupEnvSchema`. A stub returning whatever the test wants would assert
 * nothing about the wiring, which is exactly where a mis-declared variable hides
 * (a missing key is `undefined` at runtime, not a compile error).
 *
 * ── WHY IT SAVES AND RESTORES `process.env` ─────────────────────────────────
 * `EnvService` reads `process.env` at construction (that is the contract — one
 * parse, cached). Tests run in the same process, so a variable left behind would
 * leak into every later spec and make failures depend on file order.
 */
export function makeEnvService(overrides: Record<string, string> = {}): EnvService {
  const saved = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }

  const service = new EnvService();

  // Restore immediately: the service has already parsed and cached its values,
  // so holding the process env mutated for the test's duration would only create
  // cross-spec leakage without changing what the service returns.
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return service;
}
