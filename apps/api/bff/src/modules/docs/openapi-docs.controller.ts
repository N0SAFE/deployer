import { Controller, Get, Header } from "@nestjs/common";

import { AllowAnonymous } from "@/core/modules/auth/decorators/decorators";
import { generateOpenApiSpec } from "@/orpc/openapi";

/**
 * Publishes this API's OpenAPI document and a browser for it.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Two consumers needed a spec and neither had one. The monolith can GENERATE a
 * document (`apps/api/src/openapi.ts` → `scripts/generate-openapi.ts`, written to
 * stdout) but nothing ever SERVED it; this tier had neither half. That is
 * blocker 7 in `docs/API-CUTOVER-STATUS.md`, and it produced two dead
 * requests that look unrelated:
 *
 *   GET /reference            → 404   the web devtools iframe's src
 *                                     (`TanStackDevTools.tsx` builds
 *                                     `${API_URL}/reference`)
 *   GET /api/auth/agent/list  → 404   `useAgents()` in the account UI, whose
 *                                     plugin (`useAgentAuth`) needs a spec to
 *                                     start from and so was never registered
 *
 * Both are the same absence: there was no published API document. Serving one
 * fixes the iframe, and unblocks agent-auth for whoever wires it next.
 *
 * ── WHY THE CONTRACT AND NOT A HAND-WRITTEN FILE ───────────────────────────
 * `appContract` is what this process actually mounts, so the document cannot
 * describe an endpoint that is not served. A static file would drift on the first
 * contract change and nothing would catch it.
 *
 * ── WHY PUBLIC ─────────────────────────────────────────────────────────────
 * `@AllowAnonymous()`: an API reference that requires a session to READ cannot be
 * used to obtain a session, and the document exposes only shape — never data. The
 * procedures it describes still enforce their own auth when CALLED.
 */
@AllowAnonymous()
@Controller()
export class OpenApiDocsController {
	/**
	 * Generated once per process.
	 *
	 * `OpenAPIGenerator.generate` walks the whole contract; doing it per request
	 * would make a documentation endpoint the most expensive route on the
	 * platform. The contract is static for the lifetime of the process, so one
	 * build is exactly right.
	 */
	private specPromise: Promise<unknown> | null = null;

	private spec(): Promise<unknown> {
		this.specPromise ??= generateOpenApiSpec();
		return this.specPromise;
	}

	/** The machine-readable document. */
	@Get("openapi.json")
	@Header("content-type", "application/json; charset=utf-8")
	async document(): Promise<unknown> {
		return this.spec();
	}

	/**
	 * A readable page for the same document.
	 *
	 * ── WHY HTML AND NOT A BUNDLED UI (Scalar/Swagger) ──────────────────────
	 * The installed oRPC (`2.0.0-beta.40`) ships no reference plugin — measured:
	 * `dist/plugins/` contains only the handler plugins, and
	 * `OpenAPIReferencePlugin` is not exported. Rendering a client-side UI would
	 * therefore add a dependency for decoration.
	 *
	 * Instead the page fetches `/openapi.json` and lists every operation, which is
	 * what the iframe is for: confirming the surface exists and is addressable.
	 * Anything richer can be layered on later without moving this route.
	 */
	@Get("reference")
	@Header("content-type", "text/html; charset=utf-8")
	async reference(): Promise<string> {
		const spec = (await this.spec()) as {
			paths?: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
		};
		const paths = spec.paths ?? {};

		const rows: string[] = [];
		for (const [path, operations] of Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))) {
			for (const [method, operation] of Object.entries(operations)) {
				const upper = method.toUpperCase();
				const tag = operation.tags?.[0] ?? "";
				rows.push(
					`<tr><td class="m">${upper}</td><td class="p">${escapeHtml(path)}</td>` +
						`<td>${escapeHtml(operation.summary ?? "")}</td>` +
						`<td class="t">${escapeHtml(tag)}</td></tr>`,
				);
			}
		}

		return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Deployer API reference</title>
<style>
  :root { color-scheme: light dark }
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px }
  h1 { font-size: 18px; margin: 0 0 4px }
  p.sub { margin: 0 0 16px; opacity: .7 }
  table { border-collapse: collapse; width: 100% }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #8883 }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; opacity: .7 }
  td.m { font-weight: 600; font-family: ui-monospace, monospace; white-space: nowrap }
  td.p { font-family: ui-monospace, monospace }
  td.t { opacity: .6; white-space: nowrap }
  a { color: inherit }
</style></head>
<body>
  <h1>Deployer API</h1>
  <p class="sub">
    ${String(rows.length)} operations &middot;
    <a href="/openapi.json">openapi.json</a>
  </p>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Summary</th><th>Tag</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>
</body></html>`;
	}
}

/** Contract text is HTML-escaped: a summary containing `<` must not break the page. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
