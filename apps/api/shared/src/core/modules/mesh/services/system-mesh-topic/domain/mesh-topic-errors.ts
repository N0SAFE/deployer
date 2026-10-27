import { MeshBaseDomainError } from "../../../shared/domain/mesh-base-error";

export class MeshTopicNamespaceAlreadyRegisteredError extends MeshBaseDomainError {
    constructor(namespace: string) {
        super(
            "mesh_topic.namespace_already_registered",
            `Namespace '${namespace}' already registered`,
        );
    }
}

export class MeshTopicNamespaceNotFoundError extends MeshBaseDomainError {
    constructor(namespace: string) {
        super("mesh_topic.namespace_not_found", `Namespace '${namespace}' not found`);
    }
}

export class MeshTopicContractNotFoundError extends MeshBaseDomainError {
    constructor(topic: string, namespace: string) {
        super(
            "mesh_topic.contract_not_found",
            `Topic contract '${topic}' is not registered in namespace '${namespace}'`,
        );
    }
}

export class MeshTopicQueryTimeoutError extends MeshBaseDomainError {
    constructor(namespace: string, responseTopic: string) {
        super(
            "mesh_topic.query_timeout",
            `Query timeout: ${namespace}:${responseTopic}`,
        );
    }
}

export class MeshTopicQueryInvalidResponseError extends MeshBaseDomainError {
    constructor() {
        super(
            "mesh_topic.query_invalid_response",
            "Query response failed contract validation",
        );
    }
}