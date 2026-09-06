import { type Observable, of } from "rxjs";
import { map } from "rxjs/operators";
import type z from "zod/v4";
import type { MeshResourceKind, MeshResourceLocation, MeshResourceLookupResult } from "@repo/contracts-entities";
import type {
    AnyRecord,
    MeshCandidatePredicate,
    MeshResourceAutoRegisterInput,
    MeshResourceDiscoveryResult,
    MeshResourceOfKind,
    MeshResourceTopologyAccessor,
    SchemaRecordOutput,
} from "../types/mesh-resource-discovery-types";
import {
    defaultQueryState,
    applyWhereInput,
    type MeshResourceQueryState,
    type MeshResourceQueryWhereInput,
} from "./mesh-resource-query-state";
import { isExpression, type MeshWhereExpression } from "./mesh-where-expression";
import { MeshResourceSubQueryBuilder } from "./mesh-resource-sub-query-builder";

import { AppError } from "@repo/errors";
// ─── Guard interne ────────────────────────────────────────────────────────────

function isMeshResourceOfKind<TKind extends MeshResourceKind>(
    candidate: MeshResourceLocation,
    kind: TKind,
): candidate is MeshResourceOfKind<TKind> {
    return candidate.kind === kind;
}

// ─── Type helpers ─────────────────────────────────────────────────────────────

type MeshWhereClauseOperator =
    | "eq" | "neq" | "in"
    | "contains" | "startsWith" | "endsWith"
    | "exists";

type MeshWhereClauseScalar = string | number | boolean | null | undefined;

/**
 * Builder fluent pour la découverte de ressources mesh.
 *
 * Immutable : chaque méthode retourne une nouvelle instance.
 * Toute la logique de filtrage est lazy — rien n'est exécuté avant
 * un appel terminal (lookup, list, first, aggregate...).
 *
 * @example
 * const result = discovery
 *   .select("stream")
 *   .where(eq(f.ownerNodeId, "node-1"))
 *   .where({ status: "active" })
 *   .first();
 */
export class MeshResourceQueryBuilder<
    TCandidate extends MeshResourceLocation = MeshResourceLocation,
    TOutput extends AnyRecord = TCandidate,
> {
    private constructor(
        private readonly topologyService: MeshResourceTopologyAccessor,
        private readonly kind: MeshResourceKind,
        private readonly state: MeshResourceQueryState,
        private readonly customPredicates: readonly MeshCandidatePredicate<TCandidate>[],
        private readonly candidateParser: (candidate: MeshResourceLocation) => TCandidate,
        private readonly projector: (candidate: TCandidate) => TOutput,
    ) {}

    // ─── Factory ──────────────────────────────────────────────────────────────

    static create<TKind extends MeshResourceKind>(
        topologyService: MeshResourceTopologyAccessor,
        kind: TKind,
    ): MeshResourceQueryBuilder<MeshResourceOfKind<TKind>, MeshResourceOfKind<TKind>> {
        const parser = (candidate: MeshResourceLocation): MeshResourceOfKind<TKind> => {
            if (!isMeshResourceOfKind(candidate, kind)) {
                throw new AppError(
                    `Mesh candidate kind mismatch: expected '${kind}', got '${candidate.kind}'.`,
"INTERNAL_ERROR");
            }
            return candidate;
        };

        return new MeshResourceQueryBuilder(
            topologyService,
            kind,
            defaultQueryState,
            [],
            parser,
            (c) => c,
        );
    }

    // ─── Cloning helpers ──────────────────────────────────────────────────────

    private clone(overrides?: {
        state?: MeshResourceQueryState;
        customPredicates?: readonly MeshCandidatePredicate<TCandidate>[];
        candidateParser?: (candidate: MeshResourceLocation) => TCandidate;
    }): MeshResourceQueryBuilder<TCandidate, TOutput> {
        return new MeshResourceQueryBuilder(
            this.topologyService,
            this.kind,
            overrides?.state ?? this.state,
            overrides?.customPredicates ?? this.customPredicates,
            overrides?.candidateParser ?? this.candidateParser,
            this.projector,
        );
    }

    private withProjector<TNext extends AnyRecord>(
        projector: (candidate: TCandidate) => TNext,
    ): MeshResourceQueryBuilder<TCandidate, TNext> {
        return new MeshResourceQueryBuilder(
            this.topologyService,
            this.kind,
            this.state,
            this.customPredicates,
            this.candidateParser,
            projector,
        );
    }

    // ─── Schema narrowing ─────────────────────────────────────────────────────

    /**
     * Affine le type du candidat via un schema Zod.
     * Les candidats qui ne satisfont pas le schema sont silencieusement exclus.
     */
    narrow<TSchema extends z.ZodType>(
        schema: TSchema,
    ): MeshResourceQueryBuilder<
        SchemaRecordOutput<TSchema> & MeshResourceLocation,
        SchemaRecordOutput<TSchema> & MeshResourceLocation
    > {
        const parser = (
            candidate: MeshResourceLocation,
        ): SchemaRecordOutput<TSchema> & MeshResourceLocation => {
            const parsed = schema.safeParse(candidate);
            if (!parsed.success) {
                throw new AppError(
                    `Mesh candidate does not satisfy selected schema: ${parsed.error.message}`,
"INTERNAL_ERROR");
            }
            return parsed.data as SchemaRecordOutput<TSchema> & MeshResourceLocation;
        };

        return new MeshResourceQueryBuilder(
            this.topologyService,
            this.kind,
            this.state,
            this.customPredicates as readonly MeshCandidatePredicate<
                SchemaRecordOutput<TSchema> & MeshResourceLocation
            >[],
            parser,
            (c) => c,
        );
    }

    // ─── Where ────────────────────────────────────────────────────────────────

    where(input: MeshResourceQueryWhereInput): MeshResourceQueryBuilder<TCandidate, TOutput>;
    where<TRecord extends AnyRecord>(
        expression: MeshWhereExpression<TRecord>,
        ...more: readonly MeshWhereExpression<TRecord>[]
    ): MeshResourceQueryBuilder<TCandidate, TOutput>;
    where(
        inputOrExpression: MeshResourceQueryWhereInput | MeshWhereExpression,
        ...more: readonly MeshWhereExpression[]
    ): MeshResourceQueryBuilder<TCandidate, TOutput> {
        if (isExpression(inputOrExpression)) {
            const all = [inputOrExpression, ...more];
            let nextState = this.state;
            const nextPredicates = [...this.customPredicates];

            for (const expr of all) {
                if (expr.applyState) nextState = expr.applyState(nextState);
                nextPredicates.push((candidate) => expr.test(candidate));
            }

            return this.clone({ state: nextState, customPredicates: nextPredicates });
        }

        return this.clone({ state: applyWhereInput(this.state, inputOrExpression) });
    }

    // ─── whereClause (API alternative sans field refs) ────────────────────────

    whereClause<K extends keyof TCandidate>(
        field: K,
        operator: "exists",
    ): MeshResourceQueryBuilder<TCandidate, TOutput>;
    whereClause<K extends keyof TCandidate>(
        field: K,
        operator: "eq" | "neq",
        value: TCandidate[K],
    ): MeshResourceQueryBuilder<TCandidate, TOutput>;
    whereClause<K extends keyof TCandidate>(
        field: K,
        operator: "in",
        value: readonly TCandidate[K][],
    ): MeshResourceQueryBuilder<TCandidate, TOutput>;
    whereClause<K extends keyof TCandidate>(
        field: K,
        operator: "contains" | "startsWith" | "endsWith",
        value: string,
    ): MeshResourceQueryBuilder<TCandidate, TOutput>;
    whereClause<K extends keyof TCandidate>(
        field: K,
        operator: MeshWhereClauseOperator,
        value?: MeshWhereClauseScalar | readonly MeshWhereClauseScalar[],
    ): MeshResourceQueryBuilder<TCandidate, TOutput> {
        const predicate: MeshCandidatePredicate<TCandidate> = (candidate) => {
            const v = candidate[field];
            switch (operator) {
                case "exists": return v !== undefined && v !== null;
                case "eq": return v === value;
                case "neq": return v !== value;
                case "in": return Array.isArray(value) && value.includes(v);
                case "contains":
                    return typeof v === "string" && typeof value === "string"
                        ? v.includes(value) : false;
                case "startsWith":
                    return typeof v === "string" && typeof value === "string"
                        ? v.startsWith(value) : false;
                case "endsWith":
                    return typeof v === "string" && typeof value === "string"
                        ? v.endsWith(value) : false;
                default: return false;
            }
        };
        return this.clone({ customPredicates: [...this.customPredicates, predicate] });
    }

    wherePredicate(
        predicate: MeshCandidatePredicate<TCandidate>,
    ): MeshResourceQueryBuilder<TCandidate, TOutput> {
        return this.clone({ customPredicates: [...this.customPredicates, predicate] });
    }

    /** Utilisé par MeshResourceSubQueryBuilder pour réinjecter son prédicat composé. */
    appendSubQueryPredicate(
        predicate: MeshCandidatePredicate<TCandidate>,
    ): MeshResourceQueryBuilder<TCandidate, TOutput> {
        return this.clone({ customPredicates: [...this.customPredicates, predicate] });
    }

    // ─── Projection ───────────────────────────────────────────────────────────

    select<const TKeys extends readonly (keyof TOutput)[]>(
        ...keys: TKeys
    ): MeshResourceQueryBuilder<TCandidate, Pick<TOutput, TKeys[number]>> {
        return this.withProjector((candidate) => {
            const current = this.projector(candidate);
            const next: Partial<Pick<TOutput, TKeys[number]>> = {};
            for (const key of keys) next[key] = current[key];
            return next as Pick<TOutput, TKeys[number]>;
        });
    }

    join<TAlias extends string, TJoinValue extends AnyRecord | MeshWhereClauseScalar | readonly unknown[]>(
        alias: TAlias,
        resolver: (candidate: TCandidate, current: TOutput) => TJoinValue,
    ): MeshResourceQueryBuilder<TCandidate, TOutput & Record<TAlias, TJoinValue>> {
        return this.withProjector((candidate) => ({
            ...this.projector(candidate),
            [alias]: resolver(candidate, this.projector(candidate)),
        }));
    }

    // ─── SubQuery ─────────────────────────────────────────────────────────────

    subQuery<TScope>(
        scopeSelector: (candidate: TCandidate) => TScope,
    ): MeshResourceSubQueryBuilder<TCandidate, TOutput, TScope> {
        return new MeshResourceSubQueryBuilder(this, scopeSelector);
    }

    // ─── Auto-register ────────────────────────────────────────────────────────

    /**
     * Enregistre une ressource dans le resource index du mesh.
     * Retourne `this` pour permettre le chaînage.
     */
    autoRegister(input: MeshResourceAutoRegisterInput): this {
        const localNode = this.topologyService.getLocalNode();

        this.topologyService.upsertResourceIndex({
            sourceNodeId: localNode.nodeId,
            replaceExistingForSource: false,
            resources: [{
                kind: this.kind,
                key: input.key,
                ownerNodeId: localNode.nodeId,
                ownerServerUrl: input.ownerServerUrl,
                endpointPath: input.endpointPath,
                endpointMethod: input.endpointMethod ?? "GET",
                protocol: input.protocol,
                persistentConnectionRequired: input.persistentConnectionRequired ?? false,
                abortEndpointPath: input.abortEndpointPath,
                priority: input.priority ?? 100,
                version: input.version ?? 1,
                updatedAt: new Date().toISOString(),
                metadata: input.metadata ?? null,
            }],
        });

        return this;
    }

    // ─── Terminaux synchrones ─────────────────────────────────────────────────

    lookupRaw(): MeshResourceLookupResult {
        if (!this.state.key) {
            throw new AppError(
                "Mesh resource query requires a key. " +
                "Use where(eq(fields.key, ...)) or where({ key: ... }).",
                "INTERNAL_ERROR",
            );
        }

        const initial = this.topologyService.lookupResource({
            kind: this.kind,
            key: this.state.key,
            includeCandidates: this.state.includeCandidates,
        });

        const filtered = initial.candidates.filter((candidate) => {
            if (this.state.protocol && candidate.protocol !== this.state.protocol) return false;
            if (this.state.ownerNodeId && candidate.ownerNodeId !== this.state.ownerNodeId) return false;
            if (this.state.endpointMethod && candidate.endpointMethod !== this.state.endpointMethod) return false;

            for (const [k, v] of Object.entries(this.state.metadata)) {
                if (candidate.metadata?.[k] !== v) return false;
            }

            const parsed = this.parseCandidate(candidate);
            if (!parsed) return false;

            return this.customPredicates.every((p) => p(parsed));
        });

        return {
            found: filtered.length > 0,
            query: {
                kind: this.kind,
                key: this.state.key,
                includeCandidates: this.state.includeCandidates,
            },
            primary: filtered[0] ?? null,
            candidates: filtered,
        };
    }

    lookup(): MeshResourceDiscoveryResult<TOutput> {
        const raw = this.lookupRaw();
        const projected = raw.candidates.flatMap((c) => {
            const parsed = this.parseCandidate(c);
            return parsed ? [this.projector(parsed)] : [];
        });
        return {
            found: projected.length > 0,
            query: raw.query,
            primary: projected[0] ?? null,
            candidates: projected,
        };
    }

    list(): TOutput[] { return this.lookup().candidates; }

    first(): TOutput | null { return this.lookup().primary; }

    firstRemote(): TOutput | null {
        const localNodeId = this.topologyService.getLocalNode().nodeId;
        for (const candidate of this.lookupRaw().candidates) {
            if (candidate.ownerNodeId === localNodeId) continue;
            const parsed = this.parseCandidate(candidate);
            if (parsed) return this.projector(parsed);
        }
        return null;
    }

    aggregate<TResult>(
        aggregator: (candidates: readonly TOutput[]) => TResult,
    ): TResult {
        return aggregator(this.list());
    }

    // ─── Terminaux réactifs ───────────────────────────────────────────────────

    lookup$(): Observable<MeshResourceDiscoveryResult<TOutput>> {
        return of(this.lookup());
    }

    candidates$(): Observable<TOutput[]> {
        return this.lookup$().pipe(map((r) => r.candidates));
    }

    first$(): Observable<TOutput | null> {
        return this.lookup$().pipe(map((r) => r.primary));
    }

    firstRemote$(): Observable<TOutput | null> {
        return of(this.firstRemote());
    }

    aggregate$<TResult>(
        aggregator: (candidates: readonly TOutput[]) => TResult,
    ): Observable<TResult> {
        return this.candidates$().pipe(map((c) => aggregator(c)));
    }

    mapCandidates$<TResult>(
        project: (candidate: TOutput, index: number) => TResult,
    ): Observable<TResult[]> {
        return this.candidates$().pipe(
            map((candidates) => candidates.map((c, i) => project(c, i))),
        );
    }

    // ─── Helpers privés ───────────────────────────────────────────────────────

    private parseCandidate(candidate: MeshResourceLocation): TCandidate | null {
        try {
            return this.candidateParser(candidate);
        } catch {
            return null;
        }
    }
}