import { createHash } from "node:crypto";

/**
 * The canonical hash an approval is bound to (`SEC-072`).
 *
 * It is computed from the PROCEDURE and the identity of what it acts on — never from a free-form blob the caller can
 * rearrange. Two calls that would do the same thing produce the same hash; anything else produces a different one, which
 * is what stops "approve the staging deploy" being replayed as "deploy v9 to prod".
 *
 * Server-side only: the web and the CLI send the same parts to the request endpoint, but the comparison happens here.
 */
export function actionHash(procedure: string, ...parts: readonly (string | number)[]): string {
	return createHash("sha256").update([procedure, ...parts.map(String)].join("\u0000")).digest("hex");
}
