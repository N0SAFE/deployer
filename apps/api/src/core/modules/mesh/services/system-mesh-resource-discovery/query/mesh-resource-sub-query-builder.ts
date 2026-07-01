import type { MeshResourceLocation } from "@repo/contracts-entities";
import type { AnyRecord, MeshCandidatePredicate } from "../types/mesh-resource-discovery-types";
import type { MeshResourceQueryBuilder } from "./mesh-resource-query-builder";
import { isRecord, isObjectLike } from "@repo/type-guards"

/**
 * Builder de sous-requête sur un scope extrait d'un candidat.
 * Typiquement utilisé pour filtrer sur `metadata` ou un champ imbriqué.
 *
 * @example
 * query
 *   .subQuery((c) => c.metadata)
 *   .whereEq("region", "eu-west-1")
 *   .whereContains("tags", "prod")
 *   .exists()
 */

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
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
            if (!scope || typeof scope !== "object") return false;
            return Reflect.get(isRecord(scope) ? scope : {}, String(key)) === value;
        });
        return this;
    }

    wherePathEq(dotPath: string, value: unknown): this {
        this.predicates.push((scope) => this.resolveDotPath(scope, dotPath) === value);
        return this;
    }

    whereIn<TKey extends keyof TScope>(key: TKey, values: readonly TScope[TKey][]): this {
        this.predicates.push((scope) => {
            if (!scope || typeof scope !== "object") return false;
            return values.includes(Reflect.get(isRecord(scope) ? scope : {}, String(key)) as TScope[TKey]);
        });
        return this;
    }

    wherePathIn(dotPath: string, values: readonly unknown[]): this {
        this.predicates.push((scope) => values.includes(this.resolveDotPath(scope, dotPath)));
        return this;
    }

    whereContains<TKey extends keyof TScope>(key: TKey, value: string): this {
        this.predicates.push((scope) => {
            if (!scope || typeof scope !== "object") return false;
            const resolved = Reflect.get(isRecord(scope) ? scope : {}, String(key));
            return typeof resolved === "string" ? resolved.includes(value) : false;
        });
        return this;
    }

    wherePathContains(dotPath: string, value: string): this {
        this.predicates.push((scope) => {
            const resolved = this.resolveDotPath(scope, dotPath);
            return typeof resolved === "string" ? resolved.includes(value) : false;
        });
        return this;
    }

    wherePredicate(predicate: (scope: TScope) => boolean): this {
        this.predicates.push(predicate);
        return this;
    }

    /**
     * Finalise la sous-requête et retourne le builder parent
     * avec le prédicat composé ajouté.
     */
    exists(): MeshResourceQueryBuilder<TCandidate, TOutput> {
        const composedPredicate: MeshCandidatePredicate<TCandidate> = (candidate) => {
            const scope = this.scopeSelector(candidate);
            return this.predicates.every((predicate) => predicate(scope));
        };
        return this.parent.appendSubQueryPredicate(composedPredicate);
    }

    private resolveDotPath(scope: unknown, dotPath: string): unknown {
        if (!dotPath) return scope;
        let current: unknown = scope;
        for (const segment of dotPath.split(".").filter(Boolean)) {
            if (!current || typeof current !== "object") return undefined;
            current = Reflect.get(isRecord(current) ? current : {}, "segment");
        }
        return current;
    }
}