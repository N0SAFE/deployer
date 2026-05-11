/**
 * Résout un aggregateId stable depuis le payload d'un événement mesh-topic.
 *
 * Stratégie : parcourt une liste de clés prioritaires dans `input`,
 * retourne la première valeur string non-vide trouvée.
 * Fallback : `namespace:topic`.
 *
 * Utilisé par :
 *  - MeshTopicPublisherService
 *  - (ancien) SystemMeshTopicService
 *
 * @example
 * resolveMeshAggregateId({
 *   namespace: "billing",
 *   topic: "invoice.created",
 *   input: { organizationId: "org-123" },
 * })
 * // → "org-123"
 */

const AGGREGATE_ID_PRIORITY_KEYS = [
    "correlationId",
    "queryId",
    "deploymentId",
    "serviceId",
    "projectId",
    "organizationId",
    "id",
] as const;

export interface MeshAggregateIdPayload {
    namespace: string;
    topic: string;
    input: Record<string, unknown>;
}

export function resolveMeshAggregateId(payload: MeshAggregateIdPayload): string {
    for (const key of AGGREGATE_ID_PRIORITY_KEYS) {
        const candidate = payload.input[key];
        if (typeof candidate === "string" && candidate.trim().length > 0) {
            return candidate;
        }
    }
    return `${payload.namespace}:${payload.topic}`;
}