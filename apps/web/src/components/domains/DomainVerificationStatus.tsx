'use client'

import React from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { CheckCircle2, Clock, XCircle, RefreshCw, Loader2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

interface DomainVerificationStatusProps {
  status: 'verified' | 'pending' | 'failed'
  domainId?: string
  organizationId?: string
  showRetry?: boolean
  className?: string
}

export function DomainVerificationStatus({ 
  status, 
  domainId,
  organizationId,
  showRetry = false,
  className 
}: DomainVerificationStatusProps) {
  const queryClient = useQueryClient()

  const retryVerification = useMutation({
    ...orpc.domain.verifyOrganizationDomain.mutationOptions(),
    onSuccess: () => {
      if (organizationId) {
        queryClient.invalidateQueries({ 
          queryKey: orpc.domain.listOrganizationDomains.queryKey({ input: { organizationId } })
        })
      }
    },
  })

  const statusConfig = {
    verified: {
      variant: 'default' as const,
      icon: CheckCircle2,
      label: 'Verified',
      className: 'bg-green-100 text-green-800 border-green-200',
    },
    pending: {
      variant: 'secondary' as const,
      icon: Clock,
      label: 'Pending',
      className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    },
    failed: {
      variant: 'destructive' as const,
      icon: XCircle,
      label: 'Failed',
      className: 'bg-red-100 text-red-800 border-red-200',
    },
  }

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <Badge variant={config.variant} className={config.className}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
      {showRetry && status === 'failed' && domainId && organizationId && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => retryVerification.mutate({ organizationId, domainId })}
          disabled={retryVerification.isPending}
        >
          {retryVerification.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          <span className="ml-1">Retry</span>
        </Button>
      )}
    </div>
  )
}
