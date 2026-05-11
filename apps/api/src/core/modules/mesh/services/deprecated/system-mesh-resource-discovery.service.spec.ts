import { describe, expect, it, vi } from "vitest";
import { firstValueFrom } from "rxjs";
import type { MeshResourceLookupResult, MeshResourceLocation } from "@repo/contracts-entities";
import {
    and,
    eq,
    meshFields,
    meshStreamResourceSchema,
    MeshResourceQueryBuilder,
    not,
    or,
    path,
    type MeshResourceTopologyAccessor,
} from "./system-mesh-resource-discovery.service";

function buildCandidate(input: {
    kind?: MeshResourceLocation["kind"];
    ownerNodeId: string;
    ownerServerUrl: string;
    key: string;
    protocol?: MeshResourceLocation["protocol"];
    endpointPath?: string;
    priority?: number;
    metadata?: Record<string, unknown> | null;
}): MeshResourceLocation {
    return {
        kind: input.kind ?? "stream",
        key: input.key,
        ownerNodeId: input.ownerNodeId,
        ownerServerUrl: input.ownerServerUrl,
        endpointPath: input.endpointPath ?? "/stream",
        endpointMethod: "GET",
        protocol: input.protocol ?? "sse",
        persistentConnectionRequired: true,
        priority: input.priority ?? 100,
        version: 1,
        updatedAt: new Date().toISOString(),
        metadata: input.metadata ?? null,
    };
}

describe("MeshResourceQueryBuilder", () => {
    it("supports where clauses + sub-query filtering", () => {
        const streamFields = meshFields(meshStreamResourceSchema);
        const localNodeId = "00000000-0000-0000-0000-000000000001";
        const remoteNodeId = "00000000-0000-0000-0000-000000000002";
        const key = "stream:deployment:dep_1";

        const candidates: MeshResourceLocation[] = [
            buildCandidate({
                ownerNodeId: localNodeId,
                ownerServerUrl: "https://local.mesh.internal",
                key,
                priority: 500,
                metadata: { streamType: "deployment", streamId: "dep_1", tags: "local" },
            }),
            buildCandidate({
                ownerNodeId: remoteNodeId,
                ownerServerUrl: "https://remote.mesh.internal",
                key,
                priority: 10,
                metadata: { streamType: "deployment", streamId: "dep_1", tags: "remote" },
            }),
        ];

        const lookupResult: MeshResourceLookupResult = {
            found: true,
            query: {
                kind: "stream",
                key,
                includeCandidates: true,
            },
            primary: candidates[0] ?? null,
            candidates,
        };

        const topologyAccessor: MeshResourceTopologyAccessor = {
            getLocalNode: () => ({ nodeId: localNodeId }),
            lookupResource: () => lookupResult,
            upsertResourceIndex: vi.fn(),
        };

        const builder = MeshResourceQueryBuilder.create(topologyAccessor, "stream")
            .where({ includeCandidates: true })
            .where(
                eq(streamFields.key, key),
                eq(streamFields.protocol, "sse"),
                eq(path(streamFields.metadata, "streamType"), "deployment"),
                eq(path(streamFields.metadata, "streamId"), "dep_1"),
            )
            .wherePredicate((candidate) => candidate.priority <= 100)
            .subQuery((candidate) => candidate.metadata ?? {})
            .whereContains("tags", "remote")
            .exists();

        const resolved = builder.lookup();

        expect(resolved.found).toBe(true);
        expect(resolved.candidates).toHaveLength(1);
        expect(resolved.primary?.ownerNodeId).toBe(remoteNodeId);
    });

    it("auto-registers local resource and resolves first remote", () => {
        const localNodeId = "00000000-0000-0000-0000-000000000001";
        const remoteNodeId = "00000000-0000-0000-0000-000000000002";
        const key = "stream:deployment:dep_2";
        const upsertSpy = vi.fn();

        const lookupResult: MeshResourceLookupResult = {
            found: true,
            query: {
                kind: "stream",
                key,
                includeCandidates: true,
            },
            primary: buildCandidate({
                ownerNodeId: localNodeId,
                ownerServerUrl: "https://local.mesh.internal",
                key,
                priority: 500,
            }),
            candidates: [
                buildCandidate({
                    ownerNodeId: localNodeId,
                    ownerServerUrl: "https://local.mesh.internal",
                    key,
                    priority: 500,
                }),
                buildCandidate({
                    ownerNodeId: remoteNodeId,
                    ownerServerUrl: "https://remote.mesh.internal",
                    key,
                    priority: 10,
                }),
            ],
        };

        const topologyAccessor: MeshResourceTopologyAccessor = {
            getLocalNode: () => ({ nodeId: localNodeId }),
            lookupResource: () => lookupResult,
            upsertResourceIndex: upsertSpy,
        };

        const remote = MeshResourceQueryBuilder.create(topologyAccessor, "stream")
            .where({ key, includeCandidates: true })
            .autoRegister({
                key,
                ownerServerUrl: "https://local.mesh.internal",
                endpointPath: "/deployments/dep_2/stream",
                protocol: "sse",
                metadata: { streamType: "deployment" },
            })
            .firstRemote();

        expect(upsertSpy).toHaveBeenCalledTimes(1);
        expect(remote?.ownerNodeId).toBe(remoteNodeId);
    });

    it("provides rxjs mapping over candidates", async () => {
        const key = "stream:deployment:dep_3";

        const topologyAccessor: MeshResourceTopologyAccessor = {
            getLocalNode: () => ({ nodeId: "00000000-0000-0000-0000-000000000001" }),
            lookupResource: () => ({
                found: true,
                query: {
                    kind: "stream",
                    key,
                    includeCandidates: true,
                },
                primary: buildCandidate({
                    ownerNodeId: "00000000-0000-0000-0000-000000000001",
                    ownerServerUrl: "https://local.mesh.internal",
                    key,
                }),
                candidates: [
                    buildCandidate({
                        ownerNodeId: "00000000-0000-0000-0000-000000000001",
                        ownerServerUrl: "https://local.mesh.internal",
                        key,
                    }),
                    buildCandidate({
                        ownerNodeId: "00000000-0000-0000-0000-000000000002",
                        ownerServerUrl: "https://remote.mesh.internal",
                        key,
                    }),
                ],
            }),
            upsertResourceIndex: vi.fn(),
        };

        const owners = await firstValueFrom(
            MeshResourceQueryBuilder.create(topologyAccessor, "stream")
                .where({ key })
                .mapCandidates$((candidate) => candidate.ownerNodeId),
        );

        expect(owners).toEqual([
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
        ]);
    });

    it("returns typed output for select + join", () => {
        const key = "stream:deployment:dep_4";
        const topologyAccessor: MeshResourceTopologyAccessor = {
            getLocalNode: () => ({ nodeId: "00000000-0000-0000-0000-000000000001" }),
            lookupResource: () => ({
                found: true,
                query: {
                    kind: "stream",
                    key,
                    includeCandidates: true,
                },
                primary: buildCandidate({
                    ownerNodeId: "00000000-0000-0000-0000-000000000001",
                    ownerServerUrl: "https://local.mesh.internal",
                    key,
                }),
                candidates: [
                    buildCandidate({
                        ownerNodeId: "00000000-0000-0000-0000-000000000001",
                        ownerServerUrl: "https://local.mesh.internal",
                        key,
                    }),
                ],
            }),
            upsertResourceIndex: vi.fn(),
        };

        const selected = MeshResourceQueryBuilder.create(topologyAccessor, "stream")
            .where({ key })
            .join("owner", (candidate) => ({
                nodeId: candidate.ownerNodeId,
                server: candidate.ownerServerUrl,
            }))
            .select("key", "owner")
            .first();

        expect(selected).toEqual({
            key,
            owner: {
                nodeId: "00000000-0000-0000-0000-000000000001",
                server: "https://local.mesh.internal",
            },
        });
    });

    it("lists only resources matching selected mesh kind", () => {
        const key = "resource:mixed-kind:1";
        const topologyAccessor: MeshResourceTopologyAccessor = {
            getLocalNode: () => ({ nodeId: "00000000-0000-0000-0000-000000000001" }),
            lookupResource: () => ({
                found: true,
                query: {
                    kind: "stream",
                    key,
                    includeCandidates: true,
                },
                primary: buildCandidate({
                    kind: "stream",
                    ownerNodeId: "00000000-0000-0000-0000-000000000001",
                    ownerServerUrl: "https://local.mesh.internal",
                    key,
                }),
                candidates: [
                    buildCandidate({
                        kind: "stream",
                        ownerNodeId: "00000000-0000-0000-0000-000000000001",
                        ownerServerUrl: "https://local.mesh.internal",
                        key,
                    }),
                    buildCandidate({
                        kind: "deployment",
                        ownerNodeId: "00000000-0000-0000-0000-000000000002",
                        ownerServerUrl: "https://remote.mesh.internal",
                        key,
                        protocol: "https",
                    }),
                ],
            }),
            upsertResourceIndex: vi.fn(),
        };

        const listed = MeshResourceQueryBuilder.create(topologyAccessor, "stream")
            .where({ key, includeCandidates: true })
            .list();

        expect(listed).toHaveLength(1);
        expect(listed[0]?.kind).toBe("stream");
    });

    it("aggregates stream event stats with aggregate and aggregate$", async () => {
        const key = "stream:deployment:event-agg";
        const topologyAccessor: MeshResourceTopologyAccessor = {
            getLocalNode: () => ({ nodeId: "00000000-0000-0000-0000-000000000001" }),
            lookupResource: () => ({
                found: true,
                query: {
                    kind: "stream",
                    key,
                    includeCandidates: true,
                },
                primary: buildCandidate({
                    ownerNodeId: "00000000-0000-0000-0000-000000000001",
                    ownerServerUrl: "https://local.mesh.internal",
                    key,
                    metadata: {
                        events: [{ type: "started" }, { type: "completed" }],
                    },
                }),
                candidates: [
                    buildCandidate({
                        ownerNodeId: "00000000-0000-0000-0000-000000000001",
                        ownerServerUrl: "https://local.mesh.internal",
                        key,
                        metadata: {
                            events: [{ type: "started" }, { type: "completed" }],
                        },
                    }),
                    buildCandidate({
                        ownerNodeId: "00000000-0000-0000-0000-000000000002",
                        ownerServerUrl: "https://remote.mesh.internal",
                        key,
                        metadata: {
                            events: [{ type: "started" }, { type: "failed" }, { type: "completed" }],
                        },
                    }),
                ],
            }),
            upsertResourceIndex: vi.fn(),
        };

        const computeSummary = (candidates: readonly MeshResourceLocation[]) => {
            const counts = {
                started: 0,
                completed: 0,
                failed: 0,
                total: 0,
            };

            for (const candidate of candidates) {
                const events = candidate.metadata && typeof candidate.metadata === "object"
                    ? candidate.metadata.events
                    : undefined;

                if (!Array.isArray(events)) {
                    continue;
                }

                for (const event of events) {
                    if (!event || typeof event !== "object") {
                        continue;
                    }

                    const type = "type" in event ? event.type : undefined;
                    if (type === "started" || type === "completed" || type === "failed") {
                        counts[type] += 1;
                        counts.total += 1;
                    }
                }
            }

            return counts;
        };

        const builder = MeshResourceQueryBuilder.create(topologyAccessor, "stream")
            .where({ key, includeCandidates: true });

        expect(builder.aggregate(computeSummary)).toEqual({
            started: 2,
            completed: 2,
            failed: 1,
            total: 5,
        });

        expect(await firstValueFrom(builder.aggregate$(computeSummary))).toEqual({
            started: 2,
            completed: 2,
            failed: 1,
            total: 5,
        });
    });

    it("supports logical expression composition for list filtering", () => {
        const streamFields = meshFields(meshStreamResourceSchema);
        const key = "stream:deployment:logical-filters";

        const topologyAccessor: MeshResourceTopologyAccessor = {
            getLocalNode: () => ({ nodeId: "00000000-0000-0000-0000-000000000001" }),
            lookupResource: () => ({
                found: true,
                query: {
                    kind: "stream",
                    key,
                    includeCandidates: true,
                },
                primary: buildCandidate({
                    ownerNodeId: "00000000-0000-0000-0000-000000000001",
                    ownerServerUrl: "https://local.mesh.internal",
                    key,
                    metadata: { region: "eu-west", stage: "prod", disabled: false },
                }),
                candidates: [
                    buildCandidate({
                        ownerNodeId: "00000000-0000-0000-0000-000000000001",
                        ownerServerUrl: "https://local.mesh.internal",
                        key,
                        metadata: { region: "eu-west", stage: "prod", disabled: false },
                    }),
                    buildCandidate({
                        ownerNodeId: "00000000-0000-0000-0000-000000000002",
                        ownerServerUrl: "https://remote.mesh.internal",
                        key,
                        metadata: { region: "us-east", stage: "preview", disabled: true },
                    }),
                ],
            }),
            upsertResourceIndex: vi.fn(),
        };

        const listed = MeshResourceQueryBuilder.create(topologyAccessor, "stream")
            .where({ key, includeCandidates: true })
            .where(
                and(
                    eq(streamFields.key, key),
                    or(
                        eq(path(streamFields.metadata, "region"), "eu-west"),
                        eq(path(streamFields.metadata, "stage"), "prod"),
                    ),
                    not(eq(path(streamFields.metadata, "disabled"), true)),
                ),
            )
            .list();

        expect(listed).toHaveLength(1);
        expect(listed[0]?.ownerNodeId).toBe("00000000-0000-0000-0000-000000000001");
    });
});
