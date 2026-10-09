'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDomainReachabilityCheck, useGetPublicIp, useNodeNetworkConfig, usePublicAccessPointLive } from '@/domains/reachability/hooks'
import type { DomainRow, ReachabilityResult, ReachabilityState } from './domain-types'

/**
 * Per-domain reachability (does it resolve to this stack's public address and
 * answer over HTTP?), checked once per domain when the list loads and on demand.
 */
export function useDomainReachability(domains: readonly DomainRow[]) {
  const check = useDomainReachabilityCheck()
  const { data: publicIpData } = useGetPublicIp()
  const { data: nodeNetwork } = useNodeNetworkConfig()
  const accessPoint = usePublicAccessPointLive()
  // The LIVE public address wins, then the node's declared address, then auto-detected.
  const publicIp =
    accessPoint.state?.kind === 'ip' && accessPoint.state.address
      ? accessPoint.state.address
      : (nodeNetwork?.publicAddress ?? publicIpData?.ip ?? null)

  const [states, setStates] = useState<Record<string, ReachabilityState>>({})
  const requested = useRef(new Set<string>())

  const { mutateAsync } = check
  const run = useCallback(
    async (domain: string, domainId: string): Promise<ReachabilityResult | null> => {
      setStates((prev) => ({ ...prev, [domainId]: { reachable: null, loading: true } }))
      try {
        const result = (await mutateAsync({ domain, expectedIp: publicIp ?? undefined })) as ReachabilityResult
        setStates((prev) => ({
          ...prev,
          [domainId]: { reachable: result.dnsMatch === true && result.httpReachable, loading: false },
        }))
        return { ...result, domain, expectedIp: publicIp ?? undefined }
      } catch {
        setStates((prev) => ({ ...prev, [domainId]: { reachable: false, loading: false } }))
        return null
      }
    },
    [mutateAsync, publicIp],
  )

  useEffect(() => {
    for (const d of domains) {
      if (requested.current.has(d.id)) continue
      requested.current.add(d.id)
      void run(d.domain, d.id)
    }
  }, [domains, run])

  return { states, run, publicIp, isChecking: check.isPending }
}
