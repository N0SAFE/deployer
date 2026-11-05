import { domainError } from '@deployer/effect-core'

/** No stored report has this id (or it is not downloadable). `what` names which kind of report. */
export class AnalyticsReportNotFound extends domainError(
    'AnalyticsReportNotFound',
    'not_found'
)<{ readonly what: string; readonly id: string }>() {
    override publicData() {
        return { id: this.id }
    }
    override publicMessage() {
        return `${this.what} "${this.id}" was not found`
    }
}

/** A field the caller must supply is missing. */
export class AnalyticsFieldRequired extends domainError(
    'AnalyticsFieldRequired',
    'validation'
)<{
    readonly field: string
}>() {
    override publicMessage() {
        return `${this.field} is required: a report configuration needs a ${this.field}`
    }
}

/** The report exists but has no content to download; `status` says why. Still a 404 to the client. */
export class AnalyticsReportNotReady extends domainError(
    'AnalyticsReportNotReady',
    'not_found'
)<{
    readonly id: string
    readonly status: string
}>() {
    override publicData() {
        return { id: this.id, status: this.status }
    }
    override publicMessage() {
        return `completed analytics report "${this.id}" was not found (status: ${this.status})`
    }
}
