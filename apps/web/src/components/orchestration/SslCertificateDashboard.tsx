'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { orpc } from '@/lib/orpc'
import type { CertificateStatus } from '@repo/api-contracts'
import { 
  Shield, 
  ShieldCheck, 
  ShieldAlert, 
  ShieldX, 
  RefreshCw, 
  AlertTriangle, 
  Clock, 
  Search,
  ExternalLink
} from 'lucide-react'

interface SslCertificateDashboardProps {
  projectId: string
}

export default function SslCertificateDashboard({ projectId }: SslCertificateDashboardProps) {
  const [selectedDomain, setSelectedDomain] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const queryClient = useQueryClient()

  // Fetch certificates list
  const { data: certificatesResponse, isLoading, refetch, isFetching } = useQuery(
    orpc.orchestration.listCertificates.queryOptions({
      input: { projectId }
    })
  )

  // Fetch individual certificate details
  const { data: certificateDetails, isLoading: isLoadingDetails } = useQuery({
    ...orpc.orchestration.getCertificateStatus.queryOptions({
      input: { domain: selectedDomain }
    }),
    enabled: !!selectedDomain
  })

  // Certificate renewal mutation
  const renewMutation = useMutation(orpc.orchestration.renewCertificate.mutationOptions({
    onSuccess: () => {
      refetch()
      if (selectedDomain) {
        queryClient.invalidateQueries({
          queryKey: ['getCertificateStatus', { domain: selectedDomain }]
        })
      }
    }
  }))

  const certificates = certificatesResponse?.data || []
  const filteredCertificates = certificates.filter((cert: CertificateStatus) => 
    cert.domain.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'valid':
        return <ShieldCheck className="h-4 w-4 text-green-600" />
      case 'expired':
        return <ShieldX className="h-4 w-4 text-red-600" />
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-600" />
      case 'error':
        return <ShieldAlert className="h-4 w-4 text-red-600" />
      default:
        return <Shield className="h-4 w-4 text-gray-600" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'valid':
        return <Badge variant="default" className="bg-green-100 text-green-800">Valid</Badge>
      case 'expired':
        return <Badge variant="destructive">Expired</Badge>
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800">Pending</Badge>
      case 'error':
        return <Badge variant="destructive">Error</Badge>
      default:
        return <Badge variant="secondary">Unknown</Badge>
    }
  }

  const getDaysUntilExpiry = (expiryDate?: Date) => {
    if (!expiryDate) return null
    const now = new Date()
    const expiry = new Date(expiryDate)
    const diffTime = expiry.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const getExpiryStatus = (expiryDate?: Date) => {
    const days = getDaysUntilExpiry(expiryDate)
    if (days === null) return null
    
    if (days < 0) return { status: 'expired', color: 'text-red-600', text: 'Expired' }
    if (days <= 7) return { status: 'critical', color: 'text-red-600', text: `${days} days left` }
    if (days <= 30) return { status: 'warning', color: 'text-yellow-600', text: `${days} days left` }
    return { status: 'good', color: 'text-green-600', text: `${days} days left` }
  }

  const handleRenewCertificate = (domain: string) => {
    renewMutation.mutate({ domain })
  }

  const certificateStats = {
    total: certificates.length,
    valid: certificates.filter((cert: CertificateStatus) => cert.status === 'valid').length,
    expired: certificates.filter((cert: CertificateStatus) => cert.status === 'expired').length,
    pending: certificates.filter((cert: CertificateStatus) => cert.status === 'pending').length,
    expiringSoon: certificates.filter((cert: CertificateStatus) => {
      const days = getDaysUntilExpiry(cert.expiryDate)
      return days !== null && days <= 30 && days > 0
    }).length
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            SSL Certificate Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
            <p className="text-muted-foreground">Loading certificates...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              SSL Certificate Dashboard
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Certificate Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{certificateStats.total}</div>
                  <p className="text-sm text-muted-foreground">Total</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{certificateStats.valid}</div>
                  <p className="text-sm text-muted-foreground">Valid</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{certificateStats.expiringSoon}</div>
                  <p className="text-sm text-muted-foreground">Expiring Soon</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{certificateStats.expired}</div>
                  <p className="text-sm text-muted-foreground">Expired</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{certificateStats.pending}</div>
                  <p className="text-sm text-muted-foreground">Pending</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Alerts for expiring certificates */}
          {certificateStats.expiringSoon > 0 && (
            <Alert className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Certificates Expiring Soon</AlertTitle>
              <AlertDescription>
                {certificateStats.expiringSoon} certificate(s) will expire within 30 days. Consider renewing them soon.
              </AlertDescription>
            </Alert>
          )}

          {certificateStats.expired > 0 && (
            <Alert variant="destructive" className="mb-6">
              <ShieldX className="h-4 w-4" />
              <AlertTitle>Expired Certificates</AlertTitle>
              <AlertDescription>
                {certificateStats.expired} certificate(s) have expired and need immediate renewal.
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="list" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="list">Certificate List</TabsTrigger>
              <TabsTrigger value="details">Certificate Details</TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search certificates by domain..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Certificates List */}
              {filteredCertificates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No certificates found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredCertificates.map((cert: CertificateStatus) => {
                    const expiryStatus = getExpiryStatus(cert.expiryDate)
                    return (
                      <Card key={cert.domain} className="transition-all hover:shadow-md">
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1">
                              {getStatusIcon(cert.status)}
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-medium">{cert.domain}</h3>
                                  {getStatusBadge(cert.status)}
                                </div>
                                <div className="text-sm text-muted-foreground mt-1">
                                  {cert.issuer && (
                                    <span className="mr-4">Issuer: {cert.issuer}</span>
                                  )}
                                  <span>Last checked: {new Date(cert.lastChecked).toLocaleString()}</span>
                                </div>
                                {cert.expiryDate && expiryStatus && (
                                  <div className="text-sm mt-1">
                                    <span className="mr-2">Expires:</span>
                                    <span className={expiryStatus.color}>
                                      {new Date(cert.expiryDate).toLocaleDateString()} ({expiryStatus.text})
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedDomain(cert.domain)}
                              >
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Details
                              </Button>
                              {cert.status !== 'pending' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleRenewCertificate(cert.domain)}
                                  disabled={renewMutation.isPending}
                                >
                                  <RefreshCw className={`h-4 w-4 mr-1 ${renewMutation.isPending ? 'animate-spin' : ''}`} />
                                  Renew
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              <div>
                <Label htmlFor="domain-select">Select Domain</Label>
                <Input
                  id="domain-select"
                  placeholder="Enter domain name..."
                  value={selectedDomain}
                  onChange={(e) => setSelectedDomain(e.target.value)}
                  className="mt-1"
                />
              </div>

              {selectedDomain && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      Certificate Details - {selectedDomain}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingDetails ? (
                      <div className="text-center py-8">
                        <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
                        <p className="text-muted-foreground">Loading certificate details...</p>
                      </div>
                    ) : certificateDetails?.data ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="text-sm font-medium">Domain</Label>
                            <p className="text-sm mt-1 font-mono bg-muted px-2 py-1 rounded">
                              {certificateDetails.data.domain}
                            </p>
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Status</Label>
                            <div className="mt-1">
                              {getStatusBadge(certificateDetails.data.status)}
                            </div>
                          </div>
                          {certificateDetails.data.issuer && (
                            <div>
                              <Label className="text-sm font-medium">Issuer</Label>
                              <p className="text-sm mt-1">{certificateDetails.data.issuer}</p>
                            </div>
                          )}
                          {certificateDetails.data.expiryDate && (
                            <div>
                              <Label className="text-sm font-medium">Expiry Date</Label>
                              <p className="text-sm mt-1">
                                {new Date(certificateDetails.data.expiryDate).toLocaleDateString()}
                              </p>
                            </div>
                          )}
                          <div>
                            <Label className="text-sm font-medium">Last Checked</Label>
                            <p className="text-sm mt-1">
                              {new Date(certificateDetails.data.lastChecked).toLocaleString()}
                            </p>
                          </div>
                        </div>

                        {certificateDetails.data.expiryDate && (() => {
                          const days = getDaysUntilExpiry(certificateDetails.data.expiryDate)
                          const expiryStatus = getExpiryStatus(certificateDetails.data.expiryDate)
                          return days !== null && (
                            <div>
                              <Label className="text-sm font-medium">Expiry Status</Label>
                              <div className="mt-2">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className={`text-sm ${expiryStatus?.color}`}>
                                    {expiryStatus?.text}
                                  </span>
                                </div>
                                <Progress 
                                  value={Math.max(0, Math.min(100, ((90 - Math.abs(days)) / 90) * 100))} 
                                  className="h-2"
                                />
                              </div>
                            </div>
                          )
                        })()}

                        <div className="flex gap-2 pt-4">
                          <Button
                            variant="outline"
                            onClick={() => handleRenewCertificate(selectedDomain)}
                            disabled={renewMutation.isPending}
                          >
                            <RefreshCw className={`h-4 w-4 mr-2 ${renewMutation.isPending ? 'animate-spin' : ''}`} />
                            Renew Certificate
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <AlertTriangle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>Certificate not found or error loading details</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}