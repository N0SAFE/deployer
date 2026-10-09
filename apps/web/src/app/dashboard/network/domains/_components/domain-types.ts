/** Shapes the Domains page reads from the API, named once. */
export interface DomainRow {
  id: string
  domain: string
  verificationStatus: string
  verificationMethod: string
  verificationToken: string
  verifiedAt: string | null
}

export interface ReachabilityResult {
  domain?: string
  resolvedIps: string[]
  httpReachable: boolean
  httpStatusCode?: number
  dnsMatch: boolean | null
  expectedIp?: string
  error?: string
}

export interface ReachabilityState {
  reachable: boolean | null
  loading: boolean
}

export type VerificationMethod = 'txt_record' | 'cname_record'

export const METHOD_LABELS: Record<string, string> = {
  txt_record: 'TXT record',
  cname_record: 'CNAME record',
}

/** Name of the record the operator must create for a domain's ownership check. */
export function verificationRecordName(domain: string, method: string): string {
  return method === 'txt_record' ? `_deployer-verify.${domain}` : '_deployer-verify'
}
