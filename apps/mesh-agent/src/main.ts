/**
 * deployer-mesh-agent — entry point.
 *
 * Binds the control handler to the unix socket, keeps the gossip listener bound to
 * whatever the mesh address currently is, and runs the tick loop. On SIGTERM it
 * stops listening but leaves the WireGuard interface up: the kernel keeps
 * forwarding with the last configuration, so restarting (or upgrading) the agent
 * does not drop a single link.
 */

import { mkdir, rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { Server } from "bun";

import { MeshAgent } from "./agent";
import { spawnCommand } from "./command-runner";
import { loadAgentConfig } from "./config";
import { createControlHandler, createGossipHandler } from "./control-server";
import { SocketDockerEngine } from "./doors/docker-engine";
import { DoorConverger } from "./doors/door-converger";
import { discoverReflexiveAddress, lanCandidates } from "./endpoint-discovery";
import { httpGossipClient } from "./gossip-client";
import { StateStore } from "./state-store";
import { KernelWireguardDriver, ObserveOnlyWireguardDriver } from "./wireguard-driver";

function log(level: "info" | "warn" | "error", message: string): void {
	const line = `${new Date().toISOString()} ${level.toUpperCase()} [mesh-agent] ${message}`;
	if (level === "error") console.error(line);
	else console.log(line);
}

async function main(): Promise<void> {
	const config = loadAgentConfig();
	const store = new StateStore(config.stateDir);
	const { identity, created } = await store.loadOrCreateIdentity();
	log("info", `${created ? "generated" : "loaded"} identity ${identity.memberId} (WireGuard ${identity.wireguardKey})`);

	const wireguard =
		config.dataplane === "kernel"
			? new KernelWireguardDriver(spawnCommand, config.interfaceName, store.scratchPath("wg.conf"))
			: new ObserveOnlyWireguardDriver();

	const agent = new MeshAgent({
		config,
		store,
		identity,
		roster: await store.loadRoster(),
		wireguard,
		gossip: httpGossipClient,
		doors: new DoorConverger(new SocketDockerEngine(config.dockerSocket)),
		discoverLan: () => lanCandidates(networkInterfaces(), config.listenPort, config.interfaceName),
		discoverReflexive: () => discoverReflexiveAddress(config.stunServers),
		now: () => Date.now(),
		random: Math.random,
		log,
	});

	await mkdir(config.socketDir, { recursive: true, mode: 0o750 });
	const socketPath = path.join(config.socketDir, "agent.sock");
	await rm(socketPath, { force: true });
	const controlHandler = createControlHandler(agent);
	const control = Bun.serve({ unix: socketPath, fetch: controlHandler });
	log("info", `control API on ${socketPath}`);

	const gossipHandler = createGossipHandler(agent);
	let gossipServer: Server<undefined> | null = null;
	let gossipAddress: string | null = null;
	const rebindGossip = () => {
		// Bound to the mesh address ONLY, and only once the interface carries it:
		// binding 0.0.0.0 would expose the roster on every interface of the host.
		const wanted = agent.interfaceUp() ? agent.meshAddress() : null;
		if (wanted === gossipAddress) return;
		void gossipServer?.stop(true);
		gossipServer = null;
		gossipAddress = null;
		if (wanted === null) return;
		try {
			gossipServer = Bun.serve({ hostname: wanted, port: config.gossipPort, fetch: gossipHandler });
			gossipAddress = wanted;
			log("info", `gossip listener on ${wanted}:${String(config.gossipPort)}`);
		} catch (error) {
			log("warn", `gossip listener on ${wanted} not bound yet: ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	let stopping = false;
	const loop = async () => {
		while (!stopping) {
			await agent.tick();
			rebindGossip();
			await Bun.sleep(config.tickMs);
		}
	};
	const shutdown = (signal: string) => {
		if (stopping) return;
		stopping = true;
		log("info", `${signal} — stopping listeners; the WireGuard interface stays up`);
		void control.stop(true);
		void gossipServer?.stop(true);
		setTimeout(() => process.exit(0), 200);
	};
	process.on("SIGTERM", () => {
		shutdown("SIGTERM");
	});
	process.on("SIGINT", () => {
		shutdown("SIGINT");
	});

	await loop();
}

main().catch((error: unknown) => {
	log("error", `fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(1);
});
