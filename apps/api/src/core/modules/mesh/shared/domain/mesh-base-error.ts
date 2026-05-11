/**
 * Classe de base pour toutes les erreurs de domaine du mesh.
 *
 * Découplée de HTTP/gRPC — un exception filter NestJS les mappe
 * vers les codes de transport appropriés.
 *
 * Usage :
 *   class MeshTrustError extends MeshBaseDomainError { ... }
 *   class MeshTopicQueryTimeoutError extends MeshBaseDomainError { ... }
 */
export class MeshBaseDomainError extends Error {
    constructor(
        public readonly code: string,
        message: string
    ) {
        super(message)
        this.name = this.constructor.name
        // Preserve stack trace in V8
        Error.captureStackTrace(this, this.constructor)
    }

    /**
     * Vérifie si une erreur inconnue est une erreur de domaine mesh.
     */
    static isMeshDomainError(error: unknown): error is MeshBaseDomainError {
        return error instanceof MeshBaseDomainError
    }

    /**
     * Vérifie si une erreur a un code spécifique.
     */
    static hasCode(error: unknown, code: string): boolean {
        return (
            MeshBaseDomainError.isMeshDomainError(error) && error.code === code
        )
    }
}
