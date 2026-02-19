'use client'

import React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { orpc } from '@/lib/orpc'
import { useQuery } from '@tanstack/react-query'

interface DomainConflictWarningProps {
  projectDomainId?: string
  subdomain?: string
  basePath?: string
  excludeMappingId?: string
  className?: string
}

export function DomainConflictWarning({ 
  projectDomainId,
  subdomain,
  basePath = '/',
  excludeMappingId,
  className 
}: DomainConflictWarningProps) {
  // Only check if we have the required data
  const shouldCheck = Boolean(projectDomainId && subdomain)

  const { data: conflictCheck, isLoading } = useQuery({
    ...orpc.domain.checkSubdomainAvailability.queryOptions({
      input: {
        projectDomainId: projectDomainId || '',
        subdomain: subdomain || '',
        basePath,
        excludeMappingId,
      },
    }),
    enabled: shouldCheck,
  })

  // Don't show anything if we're not checking
  if (!shouldCheck) {
    return null
  }

  if (isLoading) {
    return (
      <Alert className={className}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertDescription>
          Checking subdomain availability...
        </AlertDescription>
      </Alert>
    )
  }

  // Don't show if available or no conflict data
  if (!conflictCheck || conflictCheck.available) {
    return null
  }

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Subdomain Conflict Detected</AlertTitle>
      <AlertDescription>
        <div className="space-y-2">
          <p>{conflictCheck.suggestions.message}</p>
          
          {conflictCheck.conflicts && conflictCheck.conflicts.length > 0 && (
            <div className="mt-2">
              <p className="font-medium text-sm mb-1">Conflicts with:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {conflictCheck.conflicts.map((conflict, index) => (
                  <li key={index}>
                    Service: {conflict.serviceName} (ID: {conflict.serviceId})
                    <br />
                    <span className="text-xs">
                      URL: {conflict.fullUrl}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conflictCheck.suggestions && conflictCheck.suggestions.availableBasePaths.length > 0 && (
            <div className="mt-3">
              <p className="font-medium text-sm mb-1">Suggested alternatives:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {conflictCheck.suggestions.availableBasePaths.map((suggestion: string, index: number) => (
                  <li key={index}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
