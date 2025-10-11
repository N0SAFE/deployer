'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { 
  Globe, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Copy, 
  CheckCircle2, 
  XCircle,
  Loader2,
  Info
} from 'lucide-react'
import { orpc } from '@/lib/orpc'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DomainVerificationStatus } from './DomainVerificationStatus'

interface OrganizationDomainManagementProps {
  organizationId: string
}

export function OrganizationDomainManagement({ organizationId }: OrganizationDomainManagementProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [verificationType, setVerificationType] = useState<'txt_record' | 'cname_record'>('txt_record')
  const queryClient = useQueryClient()

  // Fetch organization domains
  const { data: domains, isLoading } = useQuery(
    orpc.domain.listOrganizationDomains.queryOptions({
      input: { organizationId },
    })
  )

  // Create domain mutation
  const createDomain = useMutation({
    ...orpc.domain.addOrganizationDomain.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listOrganizationDomains.queryKey({ input: { organizationId } })
      })
      setIsAddDialogOpen(false)
      setNewDomain('')
    },
  })

  // Delete domain mutation
  const deleteDomain = useMutation({
    ...orpc.domain.deleteOrganizationDomain.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listOrganizationDomains.queryKey({ input: { organizationId } })
      })
    },
  })

  // Verify domain mutation
  const verifyDomain = useMutation({
    ...orpc.domain.verifyOrganizationDomain.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.listOrganizationDomains.queryKey({ input: { organizationId } })
      })
    },
  })

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return
    await createDomain.mutateAsync({
      organizationId,
      domain: newDomain.trim(),
      verificationMethod: verificationType,
    })
  }

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const getVerificationInstructions = (domain: { verificationMethod: string; verificationToken: string; domain: string }) => {
    if (domain.verificationMethod === 'txt_record') {
      return {
        recordType: 'TXT',
        recordName: `_deployer-verify.${domain.domain}`,
        recordValue: domain.verificationToken,
      }
    } else {
      return {
        recordType: 'CNAME',
        recordName: `_deployer-verify.${domain.domain}`,
        recordValue: `verify.deployer.app`,
      }
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Organization Domains
              </CardTitle>
              <CardDescription>
                Manage custom domains for your organization
              </CardDescription>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Domain
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add Organization Domain</DialogTitle>
                  <DialogDescription>
                    Add a custom domain to your organization. You&apos;ll need to verify ownership via DNS records.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="domain">Domain Name</Label>
                    <Input
                      id="domain"
                      placeholder="example.com"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Enter your domain without http:// or https://
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="verificationType">Verification Method</Label>
                    <Select
                      value={verificationType}
                      onValueChange={(value: 'txt_record' | 'cname_record') => setVerificationType(value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="txt_record">TXT Record (Recommended)</SelectItem>
                        <SelectItem value="cname_record">CNAME Record</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground mt-1">
                      Choose how you want to verify domain ownership
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleAddDomain}
                    disabled={createDomain.isPending || !newDomain.trim()}
                  >
                    {createDomain.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Add Domain
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : domains && Array.isArray(domains) && domains.length > 0 ? (
            <div className="space-y-4">
              {domains.map((domain) => {
                const instructions = getVerificationInstructions(domain)
                return (
                  <Card key={domain.id}>
                    <CardContent className="pt-6">
                      <div className="space-y-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{domain.domain}</h3>
                              <DomainVerificationStatus status={domain.verificationStatus} />
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Added {new Date(domain.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            {domain.verificationStatus === 'pending' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => verifyDomain.mutate({ organizationId, domainId: domain.id })}
                                disabled={verifyDomain.isPending}
                              >
                                {verifyDomain.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deleteDomain.mutate({ organizationId, domainId: domain.id })}
                              disabled={deleteDomain.isPending}
                            >
                              {deleteDomain.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>

                        {domain.verificationStatus === 'pending' && (
                          <Alert>
                            <Info className="h-4 w-4" />
                            <AlertDescription>
                              <div className="space-y-3">
                                <p className="font-medium">DNS Verification Required</p>
                                <p className="text-sm">
                                  Add this {instructions.recordType} record to your DNS configuration:
                                </p>
                                <div className="bg-muted p-3 rounded-md space-y-2 text-sm font-mono">
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Type:</span>
                                    <div className="flex items-center gap-2">
                                      <span>{instructions.recordType}</span>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleCopyToClipboard(instructions.recordType)}
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Name:</span>
                                    <div className="flex items-center gap-2">
                                      <span className="break-all">{instructions.recordName}</span>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleCopyToClipboard(instructions.recordName)}
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Value:</span>
                                    <div className="flex items-center gap-2">
                                      <span className="break-all">{instructions.recordValue}</span>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleCopyToClipboard(instructions.recordValue)}
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  DNS changes may take up to 48 hours to propagate. The system automatically 
                                  checks pending domains every hour.
                                </p>
                              </div>
                            </AlertDescription>
                          </Alert>
                        )}

                        {domain.verificationStatus === 'verified' && domain.verifiedAt && (
                          <Alert className="bg-green-50 border-green-200">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            <AlertDescription className="text-green-800">
                              Domain verified on {new Date(domain.verifiedAt).toLocaleDateString()}
                            </AlertDescription>
                          </Alert>
                        )}

                        {domain.verificationStatus === 'failed' && (
                          <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertDescription>
                              Verification failed. Please check your DNS records and try again.
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">No domains added yet</p>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Domain
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
