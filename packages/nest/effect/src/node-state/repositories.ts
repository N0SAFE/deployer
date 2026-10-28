import type { DockerodeNodeSummary, ClusterSnapshot } from "@deployer/contracts-entities";
import {
	makeClusterNodeInventoryRepository,
	makeClusterNodeRepository,
	makeNodeConfigRepository,
	type ClusterNodeInventoryRepositoryShape,
	type ClusterNodeRepositoryShape,
	type EngineNodeRow,
	type NodeConfigRepositoryShape,
	type NodeConfigRow,
} from "@deployer/node-state";
import { Injectable } from "@nestjs/common";
import { runSyncUnwrapped } from "@deployer/effect-core";

import { LocalDatabaseHost } from "./local-database.host";

type NodeConfigInsert = Parameters<NodeConfigRepositoryShape["upsert"]>[0];

/**
 * Synchronous faces of the Effect repositories in `@deployer/node-state`, for the Nest callers that
 * read node state without awaiting: the local database is synchronous, so each Effect runs to
 * completion in place. A failure is thrown as the original typed error.
 */
@Injectable()
export class NodeConfigRepository {
	private readonly repository: NodeConfigRepositoryShape;
	constructor(host: LocalDatabaseHost) {
		this.repository = makeNodeConfigRepository(host.database);
	}
	find(): NodeConfigRow | null {
		return runSyncUnwrapped(this.repository.find());
	}
	upsert(data: NodeConfigInsert): NodeConfigRow {
		return runSyncUnwrapped(this.repository.upsert(data));
	}
	getMeshSharedSecret(): string | null {
		return runSyncUnwrapped(this.repository.getMeshSharedSecret());
	}
	updateMeshPeers(peerUrls: string[]): NodeConfigRow | null {
		return runSyncUnwrapped(this.repository.updateMeshPeers(peerUrls));
	}
}

@Injectable()
export class ClusterNodeRepository {
	private readonly repository: ClusterNodeRepositoryShape;
	constructor(host: LocalDatabaseHost) {
		this.repository = makeClusterNodeRepository(host.database);
	}
	find() {
		return runSyncUnwrapped(this.repository.find());
	}
	upsertFromSnapshot(snapshot: ClusterSnapshot) {
		return runSyncUnwrapped(this.repository.upsertFromSnapshot(snapshot));
	}
	claimMaster(nodeId: string, expectedTerm: number, reason: string): boolean {
		return runSyncUnwrapped(this.repository.claimMaster(nodeId, expectedTerm, reason));
	}
	touchMasterHeartbeat(): void {
		runSyncUnwrapped(this.repository.touchMasterHeartbeat());
	}
	recordMasterHistory(nodeId: string, term: number, reason: string, durationMs: number | null = null): void {
		runSyncUnwrapped(this.repository.recordMasterHistory(nodeId, term, reason, durationMs));
	}
}

@Injectable()
export class ClusterNodeInventoryRepository {
	private readonly repository: ClusterNodeInventoryRepositoryShape;
	constructor(host: LocalDatabaseHost) {
		this.repository = makeClusterNodeInventoryRepository(host.database);
	}
	list() {
		return runSyncUnwrapped(this.repository.list());
	}
	findByNodeId(nodeId: string) {
		return runSyncUnwrapped(this.repository.findByNodeId(nodeId));
	}
	upsertFromEngine(node: EngineNodeRow) {
		return runSyncUnwrapped(this.repository.upsertFromEngine(node));
	}
	markMissingNodeDown(nodeIdsSeen: string[]): number {
		return runSyncUnwrapped(this.repository.markMissingNodeDown(nodeIdsSeen));
	}
	upsertAllFromEngine(nodes: DockerodeNodeSummary[]): number {
		return runSyncUnwrapped(this.repository.upsertAllFromEngine(nodes));
	}
}
