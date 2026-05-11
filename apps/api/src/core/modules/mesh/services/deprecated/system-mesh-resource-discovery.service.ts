import { Injectable } from "@nestjs/common";
import { Observable, of } from "rxjs";
import { map } from "rxjs/operators";
import z from "zod/v4";
import {
    meshResourceLocationSchema,
    type MeshDirectProtocol,
    type MeshResourceKind,
    type MeshResourceLocation,
    type MeshResourceLookupResult,
} from "@repo/contracts-entities";
import { SystemMeshTopologyService } from "../system-mesh-topology/orchestrator/system-mesh-topology.service";

type AnyRecord<TValue = unknown> = Record<string, TValue>;
type SchemaRecordOutput<TSchema extends z.ZodType> = z.output<TSchema> extends AnyRecord
    ? z.output<TSchema>
    : never;
type MeshCandidatePredicate<TCandidate extends MeshResourceLocation = MeshResourceLocation> = (candidate: TCandidate) => boolean;

type MeshWhereClauseOperator = "eq" | "neq" | "in" | "contains" | "startsWith" | "endsWith" | "exists";
type MeshWhereClauseScalar = string | number | boolean | null | undefined;
type MeshResourceOfKind<TKind extends MeshResourceKind> = Omit<MeshResourceLocation, "kind"> & { kind: TKind };

export const meshDeploymentResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("deployment"),
});
export const meshStreamResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("stream"),
});
export const meshLogResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("log"),
});
export const meshQueueResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("queue"),
});
export const meshTopicResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("topic"),
});

const registeredSchemaKinds = new WeakMap<z.ZodType, MeshResourceKind>([
    [meshDeploymentResourceSchema, "deployment"],
    [meshStreamResourceSchema, "stream"],
    [meshLogResourceSchema, "log"],
    [meshQueueResourceSchema, "queue"],
    [meshTopicResourceSchema, "topic"],
]);

interface MeshResourceQueryWhereInput {
    organizationId?: string | null;
    key?: string;
    includeCandidates?: boolean;
    protocol?: MeshDirectProtocol;
    ownerNodeId?: string;
    endpointMethod?: MeshResourceLocation["endpointMethod"];
    metadata?: Record<string, unknown>;
}

interface MeshResourceAutoRegisterInput {
    organizationId?: string | null;
    key: string;
    ownerServerUrl: string;
    endpointPath: string;
    endpointMethod?: MeshResourceLocation["endpointMethod"];
    protocol: MeshDirectProtocol;
    persistentConnectionRequired?: boolean;
    abortEndpointPath?: string;
    priority?: number;
    version?: number;
    metadata?: Record<string, unknown> | null;
}

interface MeshResourceQueryState {
    organizationId: string | null;
    key: string | null;
    includeCandidates: boolean;
    protocol?: MeshDirectProtocol;
    ownerNodeId?: string;
    endpointMethod?: MeshResourceLocation["endpointMethod"];
    metadata: Record<string, unknown>;
}

const meshFieldRefSymbol = Symbol("mesh-field-ref");
const meshExpressionSymbol = Symbol("mesh-expression");

type MeshFieldKey<TRecord> = Extract<keyof TRecord, string>;

export interface MeshFieldRef<TRecord extends AnyRecord, TValue> {
    readonly [meshFieldRefSymbol]: true;
    readonly key: MeshFieldKey<TRecord>;
    readonly path: readonly string[];
    readonly rootKey: string;
    readonly __valueType?: TValue;
}

export type MeshFieldMap<TRecord extends AnyRecord> = {
    [K in MeshFieldKey<TRecord>]-?: MeshFieldRef<TRecord, TRecord[K]>;
};

export interface MeshWhereExpression<TRecord extends AnyRecord = AnyRecord> {
    readonly [meshExpressionSymbol]: true;
    readonly test: (record: TRecord) => boolean;
    readonly applyState?: (state: MeshResourceQueryState) => MeshResourceQueryState;
}

function makeFieldRef<TRecord extends AnyRecord, TValue>(
    key: MeshFieldKey<TRecord>,
    pathSegments: readonly string[] = [],
): MeshFieldRef<TRecord, TValue> {
    return {
        [meshFieldRefSymbol]: true,
        key,
        path: pathSegments,
        rootKey: key,
    };
}

function makeExpression<TRecord extends AnyRecord>(input: {
    test: (record: TRecord) => boolean;
    applyState?: (state: MeshResourceQueryState) => MeshResourceQueryState;
}): MeshWhereExpression<TRecord> {
    return {
        [meshExpressionSymbol]: true,
        test: input.test,
        applyState: input.applyState,
    };
}

function isExpression(value: unknown): value is MeshWhereExpression {
    return Boolean(
        value
        && typeof value === "object"
        && meshExpressionSymbol in value,
    );
}

function resolvePathValue(record: AnyRecord, key: string, pathSegments: readonly string[]): unknown {
    let current: unknown = record[key];

    for (const segment of pathSegments) {
        if (!current || typeof current !== "object") {
            return undefined;
        }

        current = (current as Record<string, unknown>)[segment];
    }

    return current;
}

function buildEqStateHint<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    value: TValue,
): ((state: MeshResourceQueryState) => MeshResourceQueryState) | undefined {
    if (field.path.length > 0) {
        return undefined;
    }

    switch (field.rootKey) {
        case "organizationId":
            if (value === null || typeof value === "string") {
                return (state) => ({
                    ...state,
                    organizationId: value as string | null,
                });
            }
            return undefined;
        case "key":
            if (typeof value === "string") {
                return (state) => ({
                    ...state,
                    key: value,
                });
            }
            return undefined;
        case "protocol":
            if (typeof value === "string") {
                return (state) => ({
                    ...state,
                    protocol: value as MeshDirectProtocol,
                });
            }
            return undefined;
        case "ownerNodeId":
            if (typeof value === "string") {
                return (state) => ({
                    ...state,
                    ownerNodeId: value,
                });
            }
            return undefined;
        case "endpointMethod":
            if (typeof value === "string") {
                return (state) => ({
                    ...state,
                    endpointMethod: value as MeshResourceLocation["endpointMethod"],
                });
            }
            return undefined;
        default:
            return undefined;
    }
}

export function meshFields<TSchema extends z.ZodType>(schema: TSchema): MeshFieldMap<SchemaRecordOutput<TSchema>> {
    if (!(schema instanceof z.ZodObject)) {
        throw new Error("meshFields(schema) requires a Zod object schema.");
    }

    const shape = schema.shape;
    const refs: Partial<MeshFieldMap<SchemaRecordOutput<TSchema>>> = {};

    for (const key of Object.keys(shape)) {
        refs[key as MeshFieldKey<SchemaRecordOutput<TSchema>>] = makeFieldRef(
            key as MeshFieldKey<SchemaRecordOutput<TSchema>>,
        );
    }

    return refs as MeshFieldMap<SchemaRecordOutput<TSchema>>;
}

export function path<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    ...pathSegments: string[]
): MeshFieldRef<TRecord, unknown> {
    return {
        [meshFieldRefSymbol]: true,
        key: field.key,
        rootKey: field.rootKey,
        path: [...field.path, ...pathSegments],
    };
}

export function eq<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    value: TValue,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => resolvePathValue(record, field.rootKey, field.path) === value,
        applyState: buildEqStateHint(field, value),
    });
}

export function neq<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    value: TValue,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => resolvePathValue(record, field.rootKey, field.path) !== value,
    });
}

export function inArray<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    values: readonly TValue[],
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => values.includes(resolvePathValue(record, field.rootKey, field.path) as TValue),
    });
}

export function contains<TRecord extends AnyRecord>(
    field: MeshFieldRef<TRecord, unknown>,
    value: string,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => {
            const resolved = resolvePathValue(record, field.rootKey, field.path);
            return typeof resolved === "string" ? resolved.includes(value) : false;
        },
    });
}

export function startsWith<TRecord extends AnyRecord>(
    field: MeshFieldRef<TRecord, unknown>,
    value: string,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => {
            const resolved = resolvePathValue(record, field.rootKey, field.path);
            return typeof resolved === "string" ? resolved.startsWith(value) : false;
        },
    });
}

export function endsWith<TRecord extends AnyRecord>(
    field: MeshFieldRef<TRecord, unknown>,
    value: string,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => {
            const resolved = resolvePathValue(record, field.rootKey, field.path);
            return typeof resolved === "string" ? resolved.endsWith(value) : false;
        },
    });
}

export function exists<TRecord extends AnyRecord>(
    field: MeshFieldRef<TRecord, unknown>,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => {
            const resolved = resolvePathValue(record, field.rootKey, field.path);
            return resolved !== undefined && resolved !== null;
        },
    });
}

export function and<TRecord extends AnyRecord>(
    ...expressions: readonly MeshWhereExpression<TRecord>[]
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => expressions.every((expression) => expression.test(record)),
        applyState: (state) => expressions.reduce((current, expression) => {
            return expression.applyState ? expression.applyState(current) : current;
        }, state),
    });
}

export function or<TRecord extends AnyRecord>(
    ...expressions: readonly MeshWhereExpression<TRecord>[]
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => expressions.some((expression) => expression.test(record)),
    });
}

export function not<TRecord extends AnyRecord>(
    expression: MeshWhereExpression<TRecord>,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => !expression.test(record),
    });
}

export interface MeshResourceTopologyAccessor {
    getLocalNode(): { nodeId: string };
    lookupResource(input: {
        organizationId?: string | null;
        kind: MeshResourceKind;
        key: string;
        includeCandidates: boolean;
    }): MeshResourceLookupResult;
    upsertResourceIndex(input: {
        organizationId?: string | null;
        sourceNodeId: string;
        replaceExistingForSource: boolean;
        resources: MeshResourceLocation[];
    }): unknown;
}

export interface MeshResourceDiscoveryResult<TOutput> {
    found: boolean;
    query: MeshResourceLookupResult["query"];
    primary: TOutput | null;
    candidates: TOutput[];
}

function isMeshResourceOfKind<TKind extends MeshResourceKind>(
    candidate: MeshResourceLocation,
    kind: TKind,
): candidate is MeshResourceOfKind<TKind> {
    return candidate.kind === kind;
}

@Injectable()
export class SystemMeshResourceDiscoveryService {
    constructor(private readonly topologyService: SystemMeshTopologyService) {}

    select<TKind extends MeshResourceKind>(kind: TKind): MeshResourceQueryBuilder<MeshResourceOfKind<TKind>, MeshResourceOfKind<TKind>>;
    select<TSchema extends z.ZodType>(
        schema: TSchema,
        kind?: MeshResourceKind,
    ): MeshResourceQueryBuilder<
        SchemaRecordOutput<TSchema> & MeshResourceLocation,
        SchemaRecordOutput<TSchema> & MeshResourceLocation
    >;
    select<TSchema extends z.ZodType, TKind extends MeshResourceKind>(
        kindOrSchema: TKind | TSchema,
        kind?: MeshResourceKind,
    ): MeshResourceQueryBuilder<MeshResourceOfKind<TKind>, MeshResourceOfKind<TKind>>
        | MeshResourceQueryBuilder<
            SchemaRecordOutput<TSchema> & MeshResourceLocation,
            SchemaRecordOutput<TSchema> & MeshResourceLocation
        > {
        if (typeof kindOrSchema === "string") {
            return MeshResourceQueryBuilder.create(this.topologyService, kindOrSchema);
        }

        const resolvedKind = kind ?? registeredSchemaKinds.get(kindOrSchema);
        if (!resolvedKind) {
            throw new Error(
                "Unable to infer mesh resource kind from schema. Pass select(schema, kind) or use a registered schema like meshStreamResourceSchema.",
            );
        }

        return MeshResourceQueryBuilder.create(this.topologyService, resolvedKind).narrow(kindOrSchema);
    }
}

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

    static create<TKind extends MeshResourceKind>(
        topologyService: MeshResourceTopologyAccessor,
        kind: TKind,
    ): MeshResourceQueryBuilder<MeshResourceOfKind<TKind>, MeshResourceOfKind<TKind>> {
        const parser = (candidate: MeshResourceLocation): MeshResourceOfKind<TKind> => {
            if (!isMeshResourceOfKind(candidate, kind)) {
                throw new Error(`Mesh candidate kind mismatch: expected '${kind}', got '${candidate.kind}'.`);
            }

            return candidate;
        };

        return new MeshResourceQueryBuilder(
            topologyService,
            kind,
            {
                organizationId: null,
                key: null,
                includeCandidates: true,
                metadata: {},
            },
            [],
            parser,
            (candidate) => candidate,
        );
    }

    private clone(input?: {
        state?: MeshResourceQueryState;
        customPredicates?: readonly MeshCandidatePredicate<TCandidate>[];
        candidateParser?: (candidate: MeshResourceLocation) => TCandidate;
    }): MeshResourceQueryBuilder<TCandidate, TOutput> {
        return new MeshResourceQueryBuilder(
            this.topologyService,
            this.kind,
            input?.state ?? this.state,
            input?.customPredicates ?? this.customPredicates,
            input?.candidateParser ?? this.candidateParser,
            this.projector,
        );
    }

    private withProjector<TNextOutput extends AnyRecord>(
        projector: (candidate: TCandidate) => TNextOutput,
    ): MeshResourceQueryBuilder<TCandidate, TNextOutput> {
        return new MeshResourceQueryBuilder(
            this.topologyService,
            this.kind,
            this.state,
            this.customPredicates,
            this.candidateParser,
            projector,
        );
    }

    private parseCandidate(candidate: MeshResourceLocation): TCandidate | null {
        try {
            return this.candidateParser(candidate);
        }
        catch {
            return null;
        }
    }

    narrow<TSchema extends z.ZodType>(
        schema: TSchema,
    ): MeshResourceQueryBuilder<SchemaRecordOutput<TSchema> & MeshResourceLocation, SchemaRecordOutput<TSchema> & MeshResourceLocation> {
        const parser = (candidate: MeshResourceLocation): SchemaRecordOutput<TSchema> & MeshResourceLocation => {
            const parsed = schema.safeParse(candidate);
            if (!parsed.success) {
                throw new Error(`Mesh candidate does not satisfy selected schema: ${parsed.error.message}`);
            }

            return parsed.data as SchemaRecordOutput<TSchema> & MeshResourceLocation;
        };

        const preservedPredicates = this.customPredicates as readonly MeshCandidatePredicate<SchemaRecordOutput<TSchema> & MeshResourceLocation>[];

        return new MeshResourceQueryBuilder(
            this.topologyService,
            this.kind,
            this.state,
            preservedPredicates,
            parser,
            (candidate) => candidate,
        );
    }

    where(input: MeshResourceQueryWhereInput): MeshResourceQueryBuilder<TCandidate, TOutput>;
    where<TRecord extends AnyRecord>(
        expression: MeshWhereExpression<TRecord>,
        ...expressions: readonly MeshWhereExpression<TRecord>[]
    ): MeshResourceQueryBuilder<TCandidate, TOutput>;
    where(
        inputOrExpression: MeshResourceQueryWhereInput | MeshWhereExpression,
        ...expressions: readonly MeshWhereExpression[]
    ): MeshResourceQueryBuilder<TCandidate, TOutput> {
        if (isExpression(inputOrExpression)) {
            const allExpressions: readonly MeshWhereExpression[] = [inputOrExpression, ...expressions];
            let nextState = this.state;
            const nextPredicates = [...this.customPredicates];

            for (const expression of allExpressions) {
                if (expression.applyState) {
                    nextState = expression.applyState(nextState);
                }
                nextPredicates.push((candidate) => expression.test(candidate));
            }

            return this.clone({
                state: nextState,
                customPredicates: nextPredicates,
            });
        }

        const input = inputOrExpression;

        const nextState: MeshResourceQueryState = {
            ...this.state,
            metadata: {
                ...this.state.metadata,
                ...(input.metadata ?? {}),
            },
        };

        if (input.organizationId !== undefined) {
            nextState.organizationId = input.organizationId;
        }
        if (input.key !== undefined) {
            nextState.key = input.key;
        }
        if (input.includeCandidates !== undefined) {
            nextState.includeCandidates = input.includeCandidates;
        }
        if (input.protocol !== undefined) {
            nextState.protocol = input.protocol;
        }
        if (input.ownerNodeId !== undefined) {
            nextState.ownerNodeId = input.ownerNodeId;
        }
        if (input.endpointMethod !== undefined) {
            nextState.endpointMethod = input.endpointMethod;
        }

        return this.clone({ state: nextState });
    }

    autoRegister(input: MeshResourceAutoRegisterInput): this {
        const localNode = this.topologyService.getLocalNode();
        const organizationId = input.organizationId ?? this.state.organizationId;

        this.topologyService.upsertResourceIndex({
            organizationId,
            sourceNodeId: localNode.nodeId,
            replaceExistingForSource: false,
            resources: [
                {
                    organizationId,
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
                },
            ],
        });

        return this;
    }

    whereClause<K extends keyof TCandidate>(field: K, operator: "exists"): MeshResourceQueryBuilder<TCandidate, TOutput>;
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
            const fieldValue = candidate[field];

            if (operator === "exists") {
                return fieldValue !== undefined && fieldValue !== null;
            }

            if (operator === "eq") {
                return fieldValue === value;
            }

            if (operator === "neq") {
                return fieldValue !== value;
            }

            if (operator === "in") {
                return Array.isArray(value) && value.includes(fieldValue);
            }

            if (operator === "contains") {
                return typeof fieldValue === "string" && typeof value === "string"
                    ? fieldValue.includes(value)
                    : false;
            }

            if (operator === "startsWith") {
                return typeof fieldValue === "string" && typeof value === "string"
                    ? fieldValue.startsWith(value)
                    : false;
            }

            return typeof fieldValue === "string" && typeof value === "string"
                ? fieldValue.endsWith(value)
                : false;
        };

        return this.clone({ customPredicates: [...this.customPredicates, predicate] });
    }

    wherePredicate(predicate: MeshCandidatePredicate<TCandidate>): MeshResourceQueryBuilder<TCandidate, TOutput> {
        return this.clone({ customPredicates: [...this.customPredicates, predicate] });
    }

    subQuery<TScope>(
        scopeSelector: (candidate: TCandidate) => TScope,
    ): MeshResourceSubQueryBuilder<TCandidate, TOutput, TScope> {
        return new MeshResourceSubQueryBuilder(this, scopeSelector);
    }

    select<const TKeys extends readonly (keyof TOutput)[]>(
        ...keys: TKeys
    ): MeshResourceQueryBuilder<TCandidate, Pick<TOutput, TKeys[number]>> {
        return this.withProjector((candidate) => {
            const current = this.projector(candidate);
            const next: Partial<Pick<TOutput, TKeys[number]>> = {};
            for (const key of keys) {
                next[key] = current[key];
            }
            return next as Pick<TOutput, TKeys[number]>;
        });
    }

    join<TAlias extends string, TJoinValue extends AnyRecord | MeshWhereClauseScalar | readonly unknown[]>(
        alias: TAlias,
        resolver: (candidate: TCandidate, current: TOutput) => TJoinValue,
    ): MeshResourceQueryBuilder<TCandidate, TOutput & Record<TAlias, TJoinValue>> {
        return this.withProjector((candidate) => {
            const current = this.projector(candidate);
            return {
                ...current,
                [alias]: resolver(candidate, current),
            };
        });
    }

    lookupRaw(): MeshResourceLookupResult {
        if (!this.state.key) {
            throw new Error("Mesh resource query requires a key. Use where(eq(fields.key, ...)) or where({ key: ... }).");
        }

        const initial = this.topologyService.lookupResource({
            organizationId: this.state.organizationId,
            kind: this.kind,
            key: this.state.key,
            includeCandidates: this.state.includeCandidates,
        });

        const filteredCandidates = initial.candidates.filter((candidate) => {
            if (this.state.protocol && candidate.protocol !== this.state.protocol) {
                return false;
            }
            if (this.state.ownerNodeId && candidate.ownerNodeId !== this.state.ownerNodeId) {
                return false;
            }
            if (this.state.endpointMethod && candidate.endpointMethod !== this.state.endpointMethod) {
                return false;
            }

            for (const [metadataKey, metadataValue] of Object.entries(this.state.metadata)) {
                if (candidate.metadata?.[metadataKey] !== metadataValue) {
                    return false;
                }
            }

            const parsedCandidate = this.parseCandidate(candidate);
            if (!parsedCandidate) {
                return false;
            }

            for (const predicate of this.customPredicates) {
                if (!predicate(parsedCandidate)) {
                    return false;
                }
            }

            return true;
        });

        return {
            found: filteredCandidates.length > 0,
            query: {
                organizationId: this.state.organizationId,
                kind: this.kind,
                key: this.state.key,
                includeCandidates: this.state.includeCandidates,
            },
            primary: filteredCandidates[0] ?? null,
            candidates: filteredCandidates,
        };
    }

    lookup(): MeshResourceDiscoveryResult<TOutput> {
        const raw = this.lookupRaw();
        const projectedCandidates = raw.candidates.flatMap((candidate) => {
            const parsedCandidate = this.parseCandidate(candidate);
            return parsedCandidate ? [this.projector(parsedCandidate)] : [];
        });
        return {
            found: projectedCandidates.length > 0,
            query: raw.query,
            primary: projectedCandidates[0] ?? null,
            candidates: projectedCandidates,
        };
    }

    list(): TOutput[] {
        return this.lookup().candidates;
    }

    aggregate<TResult>(aggregator: (candidates: readonly TOutput[]) => TResult): TResult {
        return aggregator(this.list());
    }

    first(): TOutput | null {
        return this.lookup().primary;
    }

    firstRemote(): TOutput | null {
        const localNodeId = this.topologyService.getLocalNode().nodeId;
        for (const candidate of this.lookupRaw().candidates) {
            if (candidate.ownerNodeId === localNodeId) {
                continue;
            }

            const parsedCandidate = this.parseCandidate(candidate);
            if (parsedCandidate) {
                return this.projector(parsedCandidate);
            }
        }

        return null;
    }

    lookup$(): Observable<MeshResourceDiscoveryResult<TOutput>> {
        return of(this.lookup());
    }

    candidates$(): Observable<TOutput[]> {
        return this.lookup$().pipe(map((result) => result.candidates));
    }

    aggregate$<TResult>(aggregator: (candidates: readonly TOutput[]) => TResult): Observable<TResult> {
        return this.candidates$().pipe(map((candidates) => aggregator(candidates)));
    }

    mapCandidates$<TResult>(project: (candidate: TOutput, index: number) => TResult): Observable<TResult[]> {
        return this.candidates$().pipe(map((candidates) => candidates.map((candidate, index) => project(candidate, index))));
    }

    first$(): Observable<TOutput | null> {
        return this.lookup$().pipe(map((result) => result.primary));
    }

    firstRemote$(): Observable<TOutput | null> {
        return of(this.firstRemote());
    }

    appendSubQueryPredicate(predicate: MeshCandidatePredicate<TCandidate>): MeshResourceQueryBuilder<TCandidate, TOutput> {
        return this.clone({ customPredicates: [...this.customPredicates, predicate] });
    }
}

export class MeshResourceSubQueryBuilder<
    TCandidate extends MeshResourceLocation,
    TOutput extends AnyRecord,
    TScope,
> {
    private readonly predicates: ((scope: TScope) => boolean)[] = [];

    constructor(
        private readonly parent: MeshResourceQueryBuilder<TCandidate, TOutput>,
        private readonly scopeSelector: (candidate: TCandidate) => TScope,
    ) {}

    whereEq<TKey extends keyof TScope>(key: TKey, value: TScope[TKey]): this {
        this.predicates.push((scope) => {
            if (!scope || typeof scope !== "object") {
                return false;
            }
            const record = scope as Record<string, unknown>;
            return record[String(key)] === value;
        });
        return this;
    }

    wherePathEq(pathValue: string, value: unknown): this {
        this.predicates.push((scope) => this.resolvePath(scope, pathValue) === value);
        return this;
    }

    whereIn<TKey extends keyof TScope>(key: TKey, values: readonly TScope[TKey][]): this {
        this.predicates.push((scope) => {
            if (!scope || typeof scope !== "object") {
                return false;
            }
            const record = scope as Record<string, unknown>;
            return values.includes(record[String(key)] as TScope[TKey]);
        });
        return this;
    }

    wherePathIn(pathValue: string, values: readonly unknown[]): this {
        this.predicates.push((scope) => values.includes(this.resolvePath(scope, pathValue)));
        return this;
    }

    whereContains<TKey extends keyof TScope>(key: TKey, value: string): this {
        this.predicates.push((scope) => {
            if (!scope || typeof scope !== "object") {
                return false;
            }
            const record = scope as Record<string, unknown>;
            const resolved = record[String(key)];
            return typeof resolved === "string" ? resolved.includes(value) : false;
        });
        return this;
    }

    wherePathContains(pathValue: string, value: string): this {
        this.predicates.push((scope) => {
            const resolved = this.resolvePath(scope, pathValue);
            return typeof resolved === "string" ? resolved.includes(value) : false;
        });
        return this;
    }

    wherePredicate(predicate: (scope: TScope) => boolean): this {
        this.predicates.push(predicate);
        return this;
    }

    exists(): MeshResourceQueryBuilder<TCandidate, TOutput> {
        return this.parent.appendSubQueryPredicate((candidate) => {
            const scope = this.scopeSelector(candidate);
            return this.predicates.every((predicate) => predicate(scope));
        });
    }

    private resolvePath(scope: unknown, pathValue: string): unknown {
        if (!pathValue) {
            return scope;
        }

        const segments = pathValue.split(".").filter((segment) => segment.length > 0);
        let current: unknown = scope;

        for (const segment of segments) {
            if (!current || typeof current !== "object") {
                return undefined;
            }

            const record = current as Record<string, unknown>;
            current = record[segment];
        }

        return current;
    }
}
