import { domainError } from '@deployer/effect-core'

/** A rotation or a retirement that would do harm, or cannot be done here. `reason` is a sentence for the operator. */
export class SecretRotationRefused extends domainError(
    'SecretRotationRefused',
    'conflict'
)<{ readonly reason: string }>() {
    override publicMessage() {
        return this.reason
    }
}
