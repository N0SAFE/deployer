/**
 * Durable agent state: the identity (private keys) and the last roster.
 *
 * Both files are written atomically (temp file + rename) with mode 0600. The
 * identity file holds ONLY the two private keys — the public halves and the member
 * id are re-derived on load, so the file cannot pair a key with the wrong id.
 */

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateMeshIdentity, restoreMeshIdentity, rosterStateSchema, type MeshIdentity, type RosterState } from "@deployer/mesh-network";
import z from "zod/v4";

const identityFileSchema = z.object({
	version: z.literal(1),
	signingPrivateKey: z.string(),
	wireguardPrivateKey: z.string(),
});

const IDENTITY_FILE = "identity.json";
const ROSTER_FILE = "roster.json";

async function writeSecretFile(file: string, content: string): Promise<void> {
	const temp = `${file}.${String(process.pid)}.tmp`;
	await writeFile(temp, content, { mode: 0o600 });
	await chmod(temp, 0o600);
	await rename(temp, file);
}

async function readOptional(file: string): Promise<string | null> {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export class StateStore {
	constructor(private readonly dir: string) {}

	/** Load the identity, generating and persisting one on first boot. */
	async loadOrCreateIdentity(): Promise<{ identity: MeshIdentity; created: boolean }> {
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		const file = path.join(this.dir, IDENTITY_FILE);
		const raw = await readOptional(file);
		if (raw !== null) {
			const stored = identityFileSchema.parse(JSON.parse(raw));
			return { identity: restoreMeshIdentity(stored), created: false };
		}
		const identity = generateMeshIdentity();
		await writeSecretFile(
			file,
			JSON.stringify({ version: 1, signingPrivateKey: identity.signingPrivateKey, wireguardPrivateKey: identity.wireguardPrivateKey }),
		);
		return { identity, created: true };
	}

	/** The last persisted roster, or null when the agent never founded or joined a cluster. */
	async loadRoster(): Promise<RosterState | null> {
		const raw = await readOptional(path.join(this.dir, ROSTER_FILE));
		return raw === null ? null : rosterStateSchema.parse(JSON.parse(raw));
	}

	async saveRoster(roster: RosterState): Promise<void> {
		await writeSecretFile(path.join(this.dir, ROSTER_FILE), JSON.stringify(roster));
	}

	/** Path for scratch files that must never leave the state dir (the wg config). */
	scratchPath(name: string): string {
		return path.join(this.dir, name);
	}
}
