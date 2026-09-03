import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MeshControlEnvelope, MeshTrustKey, MeshTrustSecretKey } from "@repo/contracts-entities";
import { CLOCK_TOKEN, type Clock } from "../../../shared/primitives/clock";
import { ID_GENERATOR_TOKEN, type IdGenerator } from "../../../shared/primitives/id-generator";
import { OrSet } from "../../../shared/primitives/or-set";
import { MeshTrustError, MeshDependencyMissingError } from "../domain/mesh-errors";
import { SystemMeshClusterRepository } from "../../../repositories/system-mesh-cluster.repository";
import { SystemMeshConfigService } from "../../system-mesh-config.service";
import { MeshIdentityService } from "./mesh-identity.service";

interface TrustKeyRecord {
    keyId: string;
    algorithm: "HS256";
    secret: string;
    status: "active" | "previous";
}

/**
 * Gestion du keyring HMAC, signature/vérification des envelopes,
 * et tracking des ACKs de rotation via OR-Set distribué.
 */
@Injectable()
export class MeshTrustService {
    private readonly logger = new Logger(MeshTrustService.name);
    private readonly keys = new Map<string, TrustKeyRecord>();
    private readonly acks = new Map<string, OrSet<string>>();
    private readonly expectedPeers = new Map<string, Set<string>>();
    private readonly rotatedAt = new Map<string, string>();
    private activeKeyId: string | null = null;

    constructor(
        @Inject(CLOCK_TOKEN) private readonly clock: Clock,
        @Inject(ID_GENERATOR_TOKEN) private readonly idGen: IdGenerator,
        private readonly identity: MeshIdentityService,
        private readonly meshConfigService: SystemMeshConfigService,
        private readonly clusterRepository?: SystemMeshClusterRepository,
    ) { this.loadEnvKey(); }

    async hydrate(): Promise<void> {
        if (!this.clusterRepository?.loadSigningKeys) return;
        try {
            const keys = await this.clusterRepository.loadSigningKeys();
            for (const k of keys) {
                this.keys.set(k.keyId, { keyId: k.keyId, algorithm: k.algorithm, secret: k.secretMaterial, status: k.status });
                if (k.status === "active") this.activeKeyId = k.keyId;
            }
        } catch (error) {
            this.logger.warn(`Trust key hydration failed: ${this.errMsg(error)}`);
        }
    }

    sign(envelope: MeshControlEnvelope): MeshControlEnvelope {
        if (!this.activeKeyId) throw new MeshTrustError("no_active_signing_key");
        const key = this.keys.get(this.activeKeyId);
        if (!key) throw new MeshTrustError("active_key_unavailable");
        const payload = this.serializeForSigning({ ...envelope, keyId: key.keyId, algorithm: key.algorithm });
        const signature = createHmac("sha256", key.secret).update(payload).digest("base64url");
        return { ...envelope, keyId: key.keyId, algorithm: key.algorithm, signature };
    }

    verify(envelope: MeshControlEnvelope): void {
        if (!envelope.keyId || !envelope.signature) throw new MeshTrustError("missing_signature");
        const key = this.keys.get(envelope.keyId);
        if (!key) throw new MeshTrustError(`unknown_key:${envelope.keyId}`);
        const payload = this.serializeForSigning({ ...envelope, algorithm: "HS256" });
        const expected = Buffer.from(createHmac("sha256", key.secret).update(payload).digest("base64url"));
        const provided = Buffer.from(envelope.signature);
        if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
            throw new MeshTrustError("invalid_signature");
        }
    }

    hasKeys(): boolean { return this.keys.size > 0; }
    getActiveKeyId(): string | null { return this.activeKeyId; }

    listKeys(): MeshTrustKey[] {
        return [...this.keys.values()]
            .map((k) => ({ keyId: k.keyId, algorithm: k.algorithm, status: k.status }))
            .sort((a, b) => a.status !== b.status ? (a.status === "active" ? -1 : 1) : a.keyId.localeCompare(b.keyId));
    }

    listSecretKeys(): MeshTrustSecretKey[] {
        return [...this.keys.values()]
            .map((k) => ({ keyId: k.keyId, algorithm: k.algorithm, status: k.status, secretMaterial: k.secret }))
            .sort((a, b) => a.status !== b.status ? (a.status === "active" ? -1 : 1) : a.keyId.localeCompare(b.keyId));
    }

    async rotate(input: { keyId?: string; secretMaterial?: string; expiresAt?: string | null }, expectedPeerNodeIds: string[]) {
        if (!this.clusterRepository?.rotateSigningKey) {
            throw new MeshDependencyMissingError("Mesh cluster repository", "rotate trust keys");
        }
        const keyId = input.keyId?.trim() ?? `mesh-k-${this.clock.nowMs().toString()}`;
        const secret = input.secretMaterial?.trim() ?? `${this.idGen.uuid()}${this.idGen.uuid()}`;
        const rotated = await this.clusterRepository.rotateSigningKey({ keyId, secretMaterial: secret, expiresAt: input.expiresAt ?? null });
        const snapshot = await this.clusterRepository.loadSigningKeys();
        const keys = snapshot.length > 0 ? snapshot : [{ keyId, algorithm: "HS256" as const, secretMaterial: secret, status: "active" as const }];

        this.expectedPeers.set(rotated.activeKeyId, new Set(expectedPeerNodeIds));
        this.acks.set(rotated.activeKeyId, new OrSet<string>());
        this.rotatedAt.set(rotated.activeKeyId, this.clock.nowIso());

        this.applySnapshot({
            activeKeyId: rotated.activeKeyId,
            keys: keys.map((k) => ({ keyId: k.keyId, algorithm: k.algorithm, secret: k.secretMaterial, status: k.status })),
        });
        return { rotated, payloadKeys: keys };
    }

    applySnapshot(input: { activeKeyId: string | null; keys: TrustKeyRecord[] }): void {
        this.keys.clear();
        for (const k of input.keys) this.keys.set(k.keyId, k);
        if (input.activeKeyId && this.keys.has(input.activeKeyId)) {
            this.activeKeyId = input.activeKeyId;
            return;
        }
        this.activeKeyId = input.keys.find((k) => k.status === "active")?.keyId ?? null;
    }

    recordAck(keyId: string, peerNodeId: string): void {
        if (!this.expectedPeers.get(keyId)?.has(peerNodeId)) return;
        const set = this.acks.get(keyId) ?? new OrSet<string>();
        set.add(peerNodeId, this.identity.tickHlc());
        this.acks.set(keyId, set);
    }

    getConvergence() {
        const keyId = this.activeKeyId;
        if (!keyId) return { activeKeyId: null, expected: 0, received: 0, pending: [] as string[], lastRotatedAt: null };
        const expected = this.expectedPeers.get(keyId) ?? new Set<string>();
        const acks = this.acks.get(keyId) ?? new OrSet<string>();
        const pending = [...expected].filter((n) => !acks.has(n)).sort();
        return { activeKeyId: keyId, expected: expected.size, received: acks.size(), pending, lastRotatedAt: this.rotatedAt.get(keyId) ?? null };
    }

    private serializeForSigning(envelope: MeshControlEnvelope): string {
        return JSON.stringify({
            envelopeId: envelope.envelopeId,
            keyId: envelope.keyId ?? null,
            algorithm: envelope.algorithm ?? "HS256",
            type: envelope.type,
            sourceNodeId: envelope.sourceNodeId,
            targetNodeId: envelope.targetNodeId,
            partitionKey: envelope.partitionKey ?? null,
            traceId: envelope.traceId ?? null,
            hop: envelope.hop,
            maxHops: envelope.maxHops,
            emittedAt: envelope.emittedAt,
            payload: envelope.payload,
        });
    }

    private loadEnvKey(): void {
        const configured = this.meshConfigService.getControlEnvelopeTrustKeys();
        if (configured.size > 0) {
            for (const [keyId, k] of configured) {
                if (k.algorithm !== "HS256") continue;
                const status = k.status === "active" ? "active" : "previous";
                this.keys.set(keyId, { keyId, algorithm: "HS256", secret: k.secret, status });
                if (status === "active") this.activeKeyId = keyId;
            }
            return;
        }
        const envKey = process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY?.trim();
        if (!envKey) return;
        const envKid = process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID?.trim() ?? "mesh-k1";
        this.keys.set(envKid, { keyId: envKid, algorithm: "HS256", secret: envKey, status: "active" });
        this.activeKeyId = envKid;
    }

    private errMsg(e: unknown): string { return e instanceof Error ? e.message : "unknown_error"; }
}