/**
 * GENERATED — the `docker` surface, delegated to `runtime`.
 *
 * Every method here is a CALL ON A TYPED CLIENT, not a relayed request: the input the
 * handler receives is the one the contract declares, and the client accepts exactly that
 * type. The BFF is a CLIENT of the service — which is what lets the orchestrators call
 * several and join the answers, and what the removed proxy middleware could not do,
 * because it relayed bytes it never parsed.
 *
 * ── WHY THERE IS NO `requireAuth()` HERE ────────────────────────────────────
 * Authorization is a property of the PROCEDURE, and the service enforces it on the leg it
 * receives (it applies `requireAuth()`, `requireMesh()` and role gates to the procedures
 * that need them). Re-applying a blanket session requirement at the BFF would BREAK the
 * procedures that are legitimately public — the health probes, the mesh endpoints, the
 * setup surface — and would put one policy in two places, where the copy that drifts is
 * the one nobody reads. The caller's credentials still travel (see `service-auth-context`),
 * so the service decides with the real session in hand.
 *
 * ── WHY THE CLIENT BINDS THE NAMESPACE CONTRACT ─────────────────────────────
 * `clients.for(service, <namespaceContract>)` — not the service's combined contract. The
 * combined one puts `list`/`findById`/`create`/`update`/`delete` on two namespaces at once
 * (project and service both declare them), so its client omits those from the root type and
 * `this.client.list(...)` would not compile. Binding the namespace keeps every call
 * unambiguous by construction, with no aliasing rules to remember.
 *
 * Regenerate with `scripts/gen-bff-delegation.py`; do not hand-edit.
 */

import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { dockerContract } from "@deployer/runtime-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class DockerDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("runtime", dockerContract);
	}

	@Implement(dockerContract.containers.list)
	containers_list() {
		return implement(dockerContract.containers.list).handler(({ input }) => this.client.containers.list(input));
	}

	@Implement(dockerContract.containers.grouped)
	containers_grouped() {
		return implement(dockerContract.containers.grouped).handler(({ input }) => this.client.containers.grouped(input));
	}

	@Implement(dockerContract.containers.linked)
	containers_linked() {
		return implement(dockerContract.containers.linked).handler(({ input }) => this.client.containers.linked(input));
	}

	@Implement(dockerContract.containers.inspect)
	containers_inspect() {
		return implement(dockerContract.containers.inspect).handler(({ input }) => this.client.containers.inspect(input));
	}

	@Implement(dockerContract.containers.actions.run)
	containers_actions_run() {
		return implement(dockerContract.containers.actions.run).handler(({ input }) => this.client.containers.actions.run(input));
	}

	@Implement(dockerContract.containers.streams.inspect)
	containers_streams_inspect() {
		return implement(dockerContract.containers.streams.inspect).handler(({ input }) => this.client.containers.streams.inspect(input));
	}

	@Implement(dockerContract.containers.streams.logs)
	containers_streams_logs() {
		return implement(dockerContract.containers.streams.logs).handler(({ input }) => this.client.containers.streams.logs(input));
	}

	@Implement(dockerContract.containers.streams.processes)
	containers_streams_processes() {
		return implement(dockerContract.containers.streams.processes).handler(({ input }) => this.client.containers.streams.processes(input));
	}

	@Implement(dockerContract.containers.streams.processLogs)
	containers_streams_processLogs() {
		return implement(dockerContract.containers.streams.processLogs).handler(({ input }) => this.client.containers.streams.processLogs(input));
	}

	@Implement(dockerContract.containers.processes.list)
	containers_processes_list() {
		return implement(dockerContract.containers.processes.list).handler(({ input }) => this.client.containers.processes.list(input));
	}

	@Implement(dockerContract.containers.logs.list)
	containers_logs_list() {
		return implement(dockerContract.containers.logs.list).handler(({ input }) => this.client.containers.logs.list(input));
	}

	@Implement(dockerContract.containers.filesystem.list)
	containers_filesystem_list() {
		return implement(dockerContract.containers.filesystem.list).handler(({ input }) => this.client.containers.filesystem.list(input));
	}

	@Implement(dockerContract.containers.filesystem.read)
	containers_filesystem_read() {
		return implement(dockerContract.containers.filesystem.read).handler(({ input }) => this.client.containers.filesystem.read(input));
	}

	@Implement(dockerContract.containers.filesystem.write)
	containers_filesystem_write() {
		return implement(dockerContract.containers.filesystem.write).handler(({ input }) => this.client.containers.filesystem.write(input));
	}

	@Implement(dockerContract.containers.filesystem.deletePath)
	containers_filesystem_deletePath() {
		return implement(dockerContract.containers.filesystem.deletePath).handler(({ input }) => this.client.containers.filesystem.deletePath(input));
	}

	@Implement(dockerContract.containers.filesystem.renamePath)
	containers_filesystem_renamePath() {
		return implement(dockerContract.containers.filesystem.renamePath).handler(({ input }) => this.client.containers.filesystem.renamePath(input));
	}

	@Implement(dockerContract.containers.filesystem.createDirectory)
	containers_filesystem_createDirectory() {
		return implement(dockerContract.containers.filesystem.createDirectory).handler(({ input }) => this.client.containers.filesystem.createDirectory(input));
	}

	@Implement(dockerContract.containers.terminal.open)
	containers_terminal_open() {
		return implement(dockerContract.containers.terminal.open).handler(({ input }) => this.client.containers.terminal.open(input));
	}

	@Implement(dockerContract.containers.terminal.stream)
	containers_terminal_stream() {
		return implement(dockerContract.containers.terminal.stream).handler(({ input }) => this.client.containers.terminal.stream(input));
	}

	@Implement(dockerContract.containers.terminal.sendInput)
	containers_terminal_sendInput() {
		return implement(dockerContract.containers.terminal.sendInput).handler(({ input }) => this.client.containers.terminal.sendInput(input));
	}

	@Implement(dockerContract.containers.terminal.close)
	containers_terminal_close() {
		return implement(dockerContract.containers.terminal.close).handler(({ input }) => this.client.containers.terminal.close(input));
	}

	@Implement(dockerContract.images.list)
	images_list() {
		return implement(dockerContract.images.list).handler(({ input }) => this.client.images.list(input));
	}

	@Implement(dockerContract.images.inspect)
	images_inspect() {
		return implement(dockerContract.images.inspect).handler(({ input }) => this.client.images.inspect(input));
	}

	@Implement(dockerContract.images.streams.inspect)
	images_streams_inspect() {
		return implement(dockerContract.images.streams.inspect).handler(({ input }) => this.client.images.streams.inspect(input));
	}

	@Implement(dockerContract.images.security.scanning.stream)
	images_security_scanning_stream() {
		return implement(dockerContract.images.security.scanning.stream).handler(({ input }) => this.client.images.security.scanning.stream(input));
	}

	@Implement(dockerContract.networks.list)
	networks_list() {
		return implement(dockerContract.networks.list).handler(({ input }) => this.client.networks.list(input));
	}

	@Implement(dockerContract.volumes.list)
	volumes_list() {
		return implement(dockerContract.volumes.list).handler(({ input }) => this.client.volumes.list(input));
	}

	@Implement(dockerContract.runtime.snapshot)
	runtime_snapshot() {
		return implement(dockerContract.runtime.snapshot).handler(({ input }) => this.client.runtime.snapshot(input));
	}

	@Implement(dockerContract.runtime.stream)
	runtime_stream() {
		return implement(dockerContract.runtime.stream).handler(({ input }) => this.client.runtime.stream(input));
	}

	@Implement(dockerContract.runtime.activity.list)
	runtime_activity_list() {
		return implement(dockerContract.runtime.activity.list).handler(({ input }) => this.client.runtime.activity.list(input));
	}

	@Implement(dockerContract.runtime.activity.detail)
	runtime_activity_detail() {
		return implement(dockerContract.runtime.activity.detail).handler(({ input }) => this.client.runtime.activity.detail(input));
	}

	@Implement(dockerContract.runtime.activityStream)
	runtime_activityStream() {
		return implement(dockerContract.runtime.activityStream).handler(({ input }) => this.client.runtime.activityStream(input));
	}

	@Implement(dockerContract.entity.list)
	entity_list() {
		return implement(dockerContract.entity.list).handler(({ input }) => this.client.entity.list(input));
	}

	@Implement(dockerContract.entity.inspect)
	entity_inspect() {
		return implement(dockerContract.entity.inspect).handler(({ input }) => this.client.entity.inspect(input));
	}

	@Implement(dockerContract.entity.stream)
	entity_stream() {
		return implement(dockerContract.entity.stream).handler(({ input }) => this.client.entity.stream(input));
	}
}
