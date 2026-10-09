/**
 * The kernel side of the mesh: one WireGuard interface, configured with `ip` and
 * `wg`.
 *
 * The interface is a HOST interface (the agent runs in the host network namespace),
 * which is the point: Swarm can then advertise the mesh address, and Docker can
 * bind the private door to it. A sidecar namespace — what the old WireGuard
 * supervisor used — made the address invisible to both.
 */

import { writeFile } from "node:fs/promises";
import { MESH_INTERFACE_MTU, parseWireguardDump, type WireguardDump } from "@repo/mesh-network";

import type { CommandRunner } from "./command-runner";

export type WireguardDriver = {
	/** Create the interface if needed and make `address/prefix` its only address. */
	ensureInterface(address: string, prefix: number): Promise<void>;
	/** Apply a rendered config with `wg syncconf` (changes only what differs). */
	syncConfig(config: string): Promise<void>;
	/** Current `wg show dump`, or null when the interface does not exist. */
	dump(): Promise<WireguardDump | null>;
	removeInterface(): Promise<void>;
}

export class WireguardCommandError extends Error {
	constructor(command: string, stderr: string) {
		super(`${command} failed: ${stderr.trim() || "no output"}`);
		this.name = "WireguardCommandError";
	}
}

export class KernelWireguardDriver implements WireguardDriver {
	constructor(
		private readonly run: CommandRunner,
		private readonly interfaceName: string,
		/** Where the config is written for `wg syncconf` — inside the 0600 state dir. */
		private readonly configPath: string,
	) {}

	private async must(command: string, args: string[]): Promise<string> {
		const result = await this.run(command, args);
		if (result.code !== 0) throw new WireguardCommandError(`${command} ${args.join(" ")}`, result.stderr);
		return result.stdout;
	}

	async ensureInterface(address: string, prefix: number): Promise<void> {
		const exists = (await this.run("ip", ["link", "show", "dev", this.interfaceName])).code === 0;
		if (!exists) await this.must("ip", ["link", "add", "dev", this.interfaceName, "type", "wireguard"]);

		const wanted = `${address}/${String(prefix)}`;
		const shown = await this.must("ip", ["-o", "-4", "address", "show", "dev", this.interfaceName]);
		const current = [...shown.matchAll(/inet (\S+)/g)].map((match) => match[1]);
		if (current.length !== 1 || current[0] !== wanted) {
			// A re-derived address (collision) must REPLACE the old one, not sit beside it.
			await this.must("ip", ["address", "flush", "dev", this.interfaceName]);
			await this.must("ip", ["address", "add", wanted, "dev", this.interfaceName]);
		}
		await this.must("ip", ["link", "set", "dev", this.interfaceName, "mtu", String(MESH_INTERFACE_MTU), "up"]);
	}

	async syncConfig(config: string): Promise<void> {
		await writeFile(this.configPath, config, { mode: 0o600 });
		await this.must("wg", ["syncconf", this.interfaceName, this.configPath]);
	}

	async dump(): Promise<WireguardDump | null> {
		const result = await this.run("wg", ["show", this.interfaceName, "dump"]);
		return result.code === 0 ? parseWireguardDump(result.stdout) : null;
	}

	async removeInterface(): Promise<void> {
		await this.run("ip", ["link", "delete", "dev", this.interfaceName]);
	}
}

/**
 * Plans and reports, never touches the kernel.
 *
 * For a dev machine without NET_ADMIN: the roster, gossip-over-LAN and door
 * convergence still run, and status says plainly that no interface exists.
 */
export class ObserveOnlyWireguardDriver implements WireguardDriver {
	ensureInterface(): Promise<void> {
		return Promise.resolve();
	}
	syncConfig(): Promise<void> {
		return Promise.resolve();
	}
	dump(): Promise<WireguardDump | null> {
		return Promise.resolve(null);
	}
	removeInterface(): Promise<void> {
		return Promise.resolve();
	}
}
