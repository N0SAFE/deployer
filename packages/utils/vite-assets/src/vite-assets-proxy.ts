/**
 * Vite assets proxy — serves the SSR client bundle under ONE path prefix.
 *
 * WHY: the API serves the React views (SSR), and their client bundle is built
 * by Vite. Vite's default layout scatters dev assets across `/@vite/client`,
 * `/@fs/`, `/node_modules/.vite/` and `/src/...`, so every one of them would
 * have to be forwarded and whitelisted individually (and each is an easy thing
 * to forget, which shows up only as a blank/inert page).
 *
 * With `base: '/vite/'` (vite.config.ts) the whole dev asset surface collapses
 * into a SINGLE prefix, and this middleware forwards exactly that one path to
 * the Vite dev server. That makes the asset surface trivially whitelistable —
 * one entry — which is the whole point.
 *
 * WHY IT ALSO REWRITES: the SSR library emits asset URLs with HARDCODED
 * root-absolute paths (`/src/views/entry-client.tsx` from
 * `TemplateParserService.getClientScriptTag`) and injects them AFTER Vite's
 * HTML transform, so they can never receive the base. Vite, meanwhile, serves
 * assets ONLY under the base (`/src/...` 404s, `/vite/src/...` 200s). This
 * middleware bridges the two: any root-absolute Vite asset path is rewritten
 * onto the base before being proxied. That is what lets the library keep
 * emitting whatever it likes while the public surface stays a single prefix.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import * as http from "node:http";
import { logger } from "@repo/logger";

const log = logger.scope("ViteAssets");

/** The single prefix every dev asset lives under (mirrors vite.config `base`). */
export const VITE_ASSETS_PREFIX = "/vite";

/**
 * Paths that must reach the Vite dev server but are NOT under the base.
 *
 * Vite's HMR client opens a WebSocket at the base, but dev also requests
 * `/@vite/client` and `/@react-refresh` at the root (they are injected by the
 * React plugin before the base is applied). Forwarding these keeps a
 * middlewareMode/standalone split from producing a half-loaded page.
 */
const ROOT_ASSET_PREFIXES = ["/src/", "/node_modules/", "/@fs/", "/@vite", "/@react-refresh"];

/**
 * Paths the browser requests automatically and that have no asset behind them.
 * Answering 204 keeps them out of the 503 path without inventing a file.
 */
const NO_CONTENT_PATHS = ["/favicon.ico"];

/** Default port, matching `server.port` in the API's vite.config.ts. */
const DEFAULT_VITE_DEV_SERVER_PORT = 5173;

/**
 * Origin of the standalone Vite dev server that builds an app's client bundle.
 *
 * `port` is REQUIRED — each SSR app runs its own Vite instance, and they differ
 * (the API on 5173, setup on 5174, because both processes are up at once during
 * onboarding). A default here would silently point one app at the other's dev
 * server, which fails as a page whose every asset 404s rather than as anything
 * that names the mistake.
 *
 * `VITE_DEV_SERVER_URL` still overrides the whole origin, for a non-default dev
 * setup (a remote Vite server, or a test double).
 */
export function resolveViteDevServerUrl(port: number = DEFAULT_VITE_DEV_SERVER_PORT): string {
	return process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${String(port)}`;
}

export function isViteAssetRequest(path: string): boolean {
	const pathname = path.split("?")[0] ?? path;
	if (pathname === VITE_ASSETS_PREFIX || pathname.startsWith(`${VITE_ASSETS_PREFIX}/`)) return true;
	if (NO_CONTENT_PATHS.includes(pathname)) return true;
	return ROOT_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Rewrite a request path onto the Vite base.
 *
 * `/src/views/entry-client.tsx` → `/vite/src/views/entry-client.tsx`
 * `/vite/@vite/client`          → unchanged (already under the base)
 * `/favicon.ico`                → unchanged (answered without upstream)
 *
 * Query strings are preserved: Vite uses them for HMR and dependency versioning.
 */
export function toViteBasePath(path: string): string {
	const [pathname, query] = path.split("?", 2) as [string, string | undefined];
	if (pathname === VITE_ASSETS_PREFIX || pathname.startsWith(`${VITE_ASSETS_PREFIX}/`)) return path;
	if (NO_CONTENT_PATHS.includes(pathname)) return path;
	const rewritten = `${VITE_ASSETS_PREFIX}${pathname}`;
	return query === undefined ? rewritten : `${rewritten}?${query}`;
}

/**
 * Create the Express middleware that proxies Vite asset requests.
 *
 * `target` is the standalone Vite dev server origin (e.g.
 * `http://127.0.0.1:5173`). When that server is not running the middleware
 * fails OPEN (calls `next()`), so a missing dev server degrades to the normal
 * gateway 503 instead of hanging the request.
 */
export function createViteAssetsProxy(target: string): RequestHandler {
	const url = new URL(target);

	return (req: Request, res: Response, next: NextFunction): void => {
		const path = req.url ?? "/";
		if (!isViteAssetRequest(path)) {
			next();
			return;
		}

		// Browser-automatic probes have no asset behind them — answering 204
		// avoids a spurious 503 in the console.
		const pathname = path.split("?")[0] ?? path;
		if (NO_CONTENT_PATHS.includes(pathname)) {
			res.status(204).end();
			return;
		}

		const upstreamPath = toViteBasePath(path);
		const upstream = http.request(
			{
				hostname: url.hostname,
				port: url.port,
				path: upstreamPath,
				method: req.method,
				headers: { ...req.headers, host: url.host },
			},
			(upstreamRes) => {
				if (!res.headersSent) {
					res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
				}
				upstreamRes.pipe(res);
			},
		);

		upstream.on("error", (error: Error) => {
			// The dev server is not up (or died). Fail open so the request falls
			// through to the gateway/router, which reports a real 503 rather than
			// an opaque proxy error.
			log.warn(`Vite asset proxy unavailable for ${path}: ${error.message}`);
			if (!res.headersSent) next();
		});

		req.pipe(upstream);
	};
}
