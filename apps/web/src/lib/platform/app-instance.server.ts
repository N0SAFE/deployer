/**
 * App-instance identity for the deployer web app (SERVER-SIDE ONLY).
 *
 * Implements the registration handshake from api-centric-deployment-architecture:
 * every web instance proves an account on the target API and receives a token
 * scoped TO THE WEB APP ITSELF (never user claims, never sent to the browser).
 *
 * Token resolution order:
 *   1. APP_INSTANCE_TOKEN env        ← managed mode (API provisions it)
 *   2. persisted token file          ← restarts reuse the same identity
 *   3. credential registration       ← BYO mode (consumer-provided account)
 *
 * Heartbeat keeps the instance "active"; an expired/revoked token transparently
 * re-registers when credentials are available.
 */
import "server-only";

/**
 * File access uses Bun's file APIs (Bun.file / Bun.write), not node:fs.
 * This module is loaded from src/instrumentation.ts, which Next.js also
 * compiles for the Edge runtime graph — node:fs / node:path / node:os
 * imports there produce "Node.js module not supported in Edge Runtime"
 * build errors. Bun globals need no imports at all.
 *
 * Runtime note: registration only executes under the Node.js server runtime
 * (see the NEXT_RUNTIME gate in src/instrumentation.ts), where the Bun
 * global is always available because `next` runs under `bun --bun`.
 */

const DEFAULT_TOKEN_FILE = "/app/.deployer/app-instance-token";

interface RegisterResponse {
	instanceId: string;
	appToken: string;
	heartbeatIntervalMs: number;
}

let cachedTokenPromise: Promise<string> | null = null;

function apiUrl(): string {
	const raw = process.env.API_URL ?? "";
	if (raw.length === 0) throw new Error("API_URL is required for app-instance registration");
	return raw.replace(/\/$/, "");
}

function tokenFilePath(): string {
	return process.env.APP_INSTANCE_TOKEN_PATH ?? DEFAULT_TOKEN_FILE;
}

async function readPersistedToken(): Promise<string | null> {
	try {
		const file = Bun.file(tokenFilePath());
		if (!(await file.exists())) return null;
		const token = (await file.text()).trim();
		return token.length > 0 ? token : null;
	} catch {
		return null;
	}
}

async function persistToken(token: string): Promise<void> {
	// createPath (default true) creates missing parent directories; mode
	// preserves the previous 0600 hardening on the persisted token.
	await Bun.write(tokenFilePath(), token, { mode: 0o600, createPath: true });
}

async function registerWithCredentials(): Promise<string> {
	const email = process.env.DEPLOYER_INSTANCE_EMAIL;
	const password = process.env.DEPLOYER_INSTANCE_PASSWORD;
	if (email === undefined || password === undefined || email.length === 0 || password.length === 0) {
		throw new Error(
			"App-instance bootstrap failed: no APP_INSTANCE_TOKEN, no persisted token, and DEPLOYER_INSTANCE_EMAIL/PASSWORD are not set",
		);
	}
	const label = process.env.DEPLOYER_INSTANCE_LABEL ?? `web-${process.env.HOSTNAME ?? "local"}`;

	const response = await fetch(`${apiUrl()}/platform/app-instances/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password, instanceLabel: label }),
	});
	if (!response.ok) {
		throw new Error(`App-instance registration failed: HTTP ${String(response.status)}`);
	}
	const data = (await response.json()) as RegisterResponse;
	await persistToken(data.appToken);
	return data.appToken;
}

/** True when the API acknowledges the token (active or revived stale). */
async function heartbeatOk(token: string): Promise<boolean> {
	try {
		const response = await fetch(`${apiUrl()}/platform/app-instances/heartbeat`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-app-instance-token": token },
			body: JSON.stringify({}),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Resolve the instance token once per server process.
 * Env token is trusted as-is (managed mode). Persisted tokens are verified
 * with a heartbeat; failures fall through to credential registration.
 */
export function getAppInstanceToken(): Promise<string> {
	cachedTokenPromise ??= (async () => {
		const envToken = process.env.APP_INSTANCE_TOKEN;
		if (envToken !== undefined && envToken.length > 0) return envToken;

		const persisted = await readPersistedToken();
		if (persisted !== null && (await heartbeatOk(persisted))) return persisted;

		return await registerWithCredentials();
	})();
	return cachedTokenPromise;
}

