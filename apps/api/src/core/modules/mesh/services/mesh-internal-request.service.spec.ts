import { describe, expect, it, afterEach, vi } from "vitest";
import {
    MeshInternalRequestService,
    MESH_INTERNAL_KEY_HEADER,
    MESH_LOCAL_ONLY_HEADER,
} from "./mesh-internal-request.service";

describe("MeshInternalRequestService", () => {
    const previousSharedSecret = process.env.MESH_STREAM_SHARED_SECRET;
    const previousStrictReplayGuard = process.env.MESH_STRICT_REPLAY_GUARD;

    afterEach(() => {
        if (typeof previousSharedSecret === "undefined") {
            delete process.env.MESH_STREAM_SHARED_SECRET;
        } else {
            process.env.MESH_STREAM_SHARED_SECRET = previousSharedSecret;
        }

        if (typeof previousStrictReplayGuard === "undefined") {
            delete process.env.MESH_STRICT_REPLAY_GUARD;
        } else {
            process.env.MESH_STRICT_REPLAY_GUARD = previousStrictReplayGuard;
        }

        vi.restoreAllMocks();
    });

    it("detects local-only requests from web Request headers", () => {
        process.env.MESH_STREAM_SHARED_SECRET = "mesh-secret";

        const service = new MeshInternalRequestService({
            getStreamSharedSecret: vi.fn(() => null),
        } as never);

        const request = new Request("http://localhost/docker", {
            headers: {
                [MESH_LOCAL_ONLY_HEADER]: "1",
                [MESH_INTERNAL_KEY_HEADER]: "mesh-secret",
            },
        });

        expect(service.isLocalOnlyMeshRequest(request)).toBe(true);
    });

    it("detects local-only requests from node-style header objects", () => {
        process.env.MESH_STREAM_SHARED_SECRET = "mesh-secret";

        const service = new MeshInternalRequestService({
            getStreamSharedSecret: vi.fn(() => null),
        } as never);

        const requestLike = {
            headers: {
                [MESH_LOCAL_ONLY_HEADER]: "true",
                [MESH_INTERNAL_KEY_HEADER]: "mesh-secret",
            },
        };

        expect(service.isLocalOnlyMeshRequest(requestLike)).toBe(true);
    });

    it("rejects local-only requests when credential is missing", () => {
        process.env.MESH_STREAM_SHARED_SECRET = "mesh-secret";

        const service = new MeshInternalRequestService({
            getStreamSharedSecret: vi.fn(() => null),
        } as never);

        const requestLike = {
            headers: {
                [MESH_LOCAL_ONLY_HEADER]: "1",
            },
        };

        expect(service.isLocalOnlyMeshRequest(requestLike)).toBe(false);
    });

    it("builds signed internal headers with local-only marker", () => {
        process.env.MESH_STREAM_SHARED_SECRET = "mesh-secret";

        const service = new MeshInternalRequestService({
            getStreamSharedSecret: vi.fn(() => null),
        } as never);

        const headers = service.buildInternalHeaders({ includeLocalOnly: true });

        expect(headers[MESH_LOCAL_ONLY_HEADER]).toBe("1");
        expect(headers[MESH_INTERNAL_KEY_HEADER]).toMatch(/^v1\./);
    });
});
