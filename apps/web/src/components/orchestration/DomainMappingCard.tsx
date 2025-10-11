'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import { orpc } from '@/lib/orpc'
import type { DomainMapping } from '@repo/api-contracts'
import {
    Globe,
    Shield,
    ShieldCheck,
    Plus,
    Trash2,
    Edit,
    Save,
    X,
    AlertCircle,
    CheckCircle,
} from 'lucide-react'

interface DomainMappingCardProps {
    stackId: string
    stackName: string
    onMappingsUpdated?: () => void
}

interface ExtendedDomainMapping extends DomainMapping {
    id: string // For React keys
}

export default function DomainMappingCard({
    stackId,
    stackName,
    onMappingsUpdated,
}: DomainMappingCardProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [editedMappings, setEditedMappings] = useState<
        ExtendedDomainMapping[]
    >([])
    const queryClient = useQueryClient()

    // Fetch current domain mappings
    const {
        data: domainMappingsResponse,
        isLoading,
        refetch,
    } = useQuery(
        orpc.orchestration.getDomainMappings.queryOptions({
            input: { stackId },
        })
    )

    // Update domain mappings mutation
    const updateMappingsMutation = useMutation(
        orpc.orchestration.updateDomainMappings.mutationOptions({
            onSuccess: ({}, { stackId }) => {
                setIsEditing(false)
                refetch()
                onMappingsUpdated?.()
                queryClient.invalidateQueries({
                    queryKey: orpc.orchestration.getDomainMappings.queryKey({
                        input: { stackId },
                    }),
                })
            },
        })
    )
    // mutationFn: async (mappings: DomainMapping[]) => {
    //   const response = await orpc.orchestration.updateDomainMappings.mutationOptions({
    //     stackId,
    //     mappings
    //   })
    //   return response
    // },
    // onSuccess: () => {
    //   setIsEditing(false)
    //   refetch()
    //   onMappingsUpdated?.()
    //   queryClient.invalidateQueries({
    //     queryKey: orpc.orchestration.getDomainMappings.queryKey({ stackId })
    //   })
    // }

    const handleEdit = () => {
        const domainMappings = domainMappingsResponse?.data
        if (domainMappings) {
            setEditedMappings(
                domainMappings.map((mapping: DomainMapping, index: number) => ({
                    ...mapping,
                    id: `${mapping.service}-${index}`,
                }))
            )
        } else {
            setEditedMappings([])
        }
        setIsEditing(true)
    }

    const handleCancel = () => {
        setIsEditing(false)
        setEditedMappings([])
    }

    const handleSave = async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const mappingsToSave = editedMappings.map(
            ({ id, ...mapping }) => mapping
        )

        updateMappingsMutation.mutate({
            stackId,
            mappings: mappingsToSave,
        })
    }

    const addDomainMapping = () => {
        const newMapping: ExtendedDomainMapping = {
            id: `new-${Date.now()}`,
            service: '',
            domains: [''],
            ssl: true,
            middleware: [],
        }
        setEditedMappings([...editedMappings, newMapping])
    }

    const removeDomainMapping = (id: string) => {
        setEditedMappings(editedMappings.filter((mapping) => mapping.id !== id))
    }

    const updateDomainMapping = (
        id: string,
        updates: Partial<ExtendedDomainMapping>
    ) => {
        setEditedMappings(
            editedMappings.map((mapping) =>
                mapping.id === id ? { ...mapping, ...updates } : mapping
            )
        )
    }

    const addDomainToDomainMapping = (mappingId: string) => {
        setEditedMappings(
            editedMappings.map((mapping) =>
                mapping.id === mappingId
                    ? { ...mapping, domains: [...mapping.domains, ''] }
                    : mapping
            )
        )
    }

    const removeDomainFromMapping = (
        mappingId: string,
        domainIndex: number
    ) => {
        setEditedMappings(
            editedMappings.map((mapping) =>
                mapping.id === mappingId
                    ? {
                          ...mapping,
                          domains: mapping.domains.filter(
                              (_, index) => index !== domainIndex
                          ),
                      }
                    : mapping
            )
        )
    }

    const updateDomainInMapping = (
        mappingId: string,
        domainIndex: number,
        domain: string
    ) => {
        setEditedMappings(
            editedMappings.map((mapping) =>
                mapping.id === mappingId
                    ? {
                          ...mapping,
                          domains: mapping.domains.map((d, index) =>
                              index === domainIndex ? domain : d
                          ),
                      }
                    : mapping
            )
        )
    }

    const getSSLStatus = (domain: string) => {
        // In a real implementation, this would check the certificate status
        // For now, we'll show mock status based on domain format
        if (domain.startsWith('*.')) {
            return {
                status: 'wildcard',
                icon: ShieldCheck,
                color: 'text-blue-600',
            }
        } else if (
            domain.includes('localhost') ||
            domain.includes('127.0.0.1')
        ) {
            return {
                status: 'local',
                icon: AlertCircle,
                color: 'text-yellow-600',
            }
        } else {
            return {
                status: 'valid',
                icon: CheckCircle,
                color: 'text-green-600',
            }
        }
    }

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Globe className="h-5 w-5" />
                        Domain Mappings
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="py-8 text-center">
                        <div className="border-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2"></div>
                        <p className="text-muted-foreground mt-2 text-sm">
                            Loading domain mappings...
                        </p>
                    </div>
                </CardContent>
            </Card>
        )
    }

    const displayMappings = isEditing
        ? editedMappings
        : domainMappingsResponse?.data?.map(
              (mapping: DomainMapping, index: number) => ({
                  ...mapping,
                  id: `${mapping.service}-${index}`,
              })
          ) || []

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Globe className="h-5 w-5" />
                        Domain Mappings - {stackName}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        {isEditing ? (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCancel}
                                    disabled={updateMappingsMutation.isPending}
                                >
                                    <X className="mr-1 h-4 w-4" />
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={updateMappingsMutation.isPending}
                                >
                                    <Save className="mr-1 h-4 w-4" />
                                    Save Changes
                                </Button>
                            </>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleEdit}
                            >
                                <Edit className="mr-1 h-4 w-4" />
                                Edit Mappings
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                {updateMappingsMutation.error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                            Failed to update domain mappings:{' '}
                            {updateMappingsMutation.error.message}
                        </AlertDescription>
                    </Alert>
                )}

                {displayMappings.length === 0 ? (
                    <div className="text-muted-foreground py-8 text-center">
                        <Globe className="mx-auto mb-2 h-12 w-12 opacity-50" />
                        <p>No domain mappings configured</p>
                        {isEditing && (
                            <Button
                                variant="outline"
                                className="mt-4"
                                onClick={addDomainMapping}
                            >
                                <Plus className="mr-1 h-4 w-4" />
                                Add Domain Mapping
                            </Button>
                        )}
                    </div>
                ) : (
                    <>
                        {displayMappings.map(
                            (mapping: ExtendedDomainMapping) => (
                                <Card
                                    key={mapping.id}
                                    className="border-l-primary/20 border-l-4"
                                >
                                    <CardContent className="pt-4">
                                        <div className="space-y-4">
                                            {/* Service Name */}
                                            <div>
                                                <Label className="text-sm font-medium">
                                                    Service
                                                </Label>
                                                {isEditing ? (
                                                    <Input
                                                        value={mapping.service}
                                                        onChange={(e) =>
                                                            updateDomainMapping(
                                                                mapping.id,
                                                                {
                                                                    service:
                                                                        e.target
                                                                            .value,
                                                                }
                                                            )
                                                        }
                                                        placeholder="Service name (e.g., web, api)"
                                                        className="mt-1"
                                                    />
                                                ) : (
                                                    <p className="bg-muted mt-1 rounded px-2 py-1 font-mono text-sm">
                                                        {mapping.service}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Domains */}
                                            <div>
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-sm font-medium">
                                                        Domains
                                                    </Label>
                                                    {isEditing && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() =>
                                                                addDomainToDomainMapping(
                                                                    mapping.id
                                                                )
                                                            }
                                                        >
                                                            <Plus className="mr-1 h-4 w-4" />
                                                            Add Domain
                                                        </Button>
                                                    )}
                                                </div>
                                                <div className="mt-2 space-y-2">
                                                    {mapping.domains.map(
                                                        (
                                                            domain: string,
                                                            domainIndex: number
                                                        ) => (
                                                            <div
                                                                key={
                                                                    domainIndex
                                                                }
                                                                className="flex items-center gap-2"
                                                            >
                                                                {isEditing ? (
                                                                    <>
                                                                        <Input
                                                                            value={
                                                                                domain
                                                                            }
                                                                            onChange={(
                                                                                e
                                                                            ) =>
                                                                                updateDomainInMapping(
                                                                                    mapping.id,
                                                                                    domainIndex,
                                                                                    e
                                                                                        .target
                                                                                        .value
                                                                                )
                                                                            }
                                                                            placeholder="example.com"
                                                                            className="flex-1"
                                                                        />
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={() =>
                                                                                removeDomainFromMapping(
                                                                                    mapping.id,
                                                                                    domainIndex
                                                                                )
                                                                            }
                                                                        >
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </Button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <div className="flex flex-1 items-center gap-2">
                                                                            <span className="font-mono text-sm">
                                                                                {
                                                                                    domain
                                                                                }
                                                                            </span>
                                                                            {domain &&
                                                                                (() => {
                                                                                    const sslStatus =
                                                                                        getSSLStatus(
                                                                                            domain
                                                                                        )
                                                                                    const StatusIcon =
                                                                                        sslStatus.icon
                                                                                    return (
                                                                                        <StatusIcon
                                                                                            className={`h-4 w-4 ${sslStatus.color}`}
                                                                                            // title={`SSL Status: ${sslStatus.status}`}
                                                                                        />
                                                                                    )
                                                                                })()}
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        )
                                                    )}
                                                </div>
                                            </div>

                                            {/* SSL and Middleware */}
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-sm font-medium">
                                                            SSL Enabled
                                                        </Label>
                                                        {isEditing ? (
                                                            <Switch
                                                                checked={
                                                                    mapping.ssl ??
                                                                    true
                                                                }
                                                                onCheckedChange={(
                                                                    ssl
                                                                ) =>
                                                                    updateDomainMapping(
                                                                        mapping.id,
                                                                        { ssl }
                                                                    )
                                                                }
                                                            />
                                                        ) : (
                                                            <Badge
                                                                variant={
                                                                    mapping.ssl
                                                                        ? 'default'
                                                                        : 'secondary'
                                                                }
                                                            >
                                                                {mapping.ssl ? (
                                                                    <>
                                                                        <ShieldCheck className="mr-1 h-3 w-3" />
                                                                        Enabled
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Shield className="mr-1 h-3 w-3" />
                                                                        Disabled
                                                                    </>
                                                                )}
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    {mapping.middleware &&
                                                        mapping.middleware
                                                            .length > 0 && (
                                                            <div className="flex items-center gap-2">
                                                                <Label className="text-sm font-medium">
                                                                    Middleware:
                                                                </Label>
                                                                <div className="flex gap-1">
                                                                    {mapping.middleware.map(
                                                                        (
                                                                            mw,
                                                                            idx
                                                                        ) => (
                                                                            <Badge
                                                                                key={
                                                                                    idx
                                                                                }
                                                                                variant="outline"
                                                                                className="text-xs"
                                                                            >
                                                                                {
                                                                                    mw
                                                                                }
                                                                            </Badge>
                                                                        )
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                </div>

                                                {isEditing && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() =>
                                                            removeDomainMapping(
                                                                mapping.id
                                                            )
                                                        }
                                                        className="text-destructive"
                                                    >
                                                        <Trash2 className="mr-1 h-4 w-4" />
                                                        Remove
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        )}

                        {isEditing && (
                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={addDomainMapping}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add Another Domain Mapping
                            </Button>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    )
}
