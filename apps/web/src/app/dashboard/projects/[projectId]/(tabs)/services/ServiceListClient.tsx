'use client'

import { useState } from 'react'
import { Plus, Search, Filter, Server } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { useServices } from '@/hooks/useServices'
import ServiceCard from '@/components/services/ServiceCard'
import CreateServiceDialog from '@/components/services/CreateServiceDialog'

interface ServiceListClientProps {
  projectId: string
}

export default function ServiceListClient({ projectId }: ServiceListClientProps) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | undefined>()
  const [isActiveFilter, setIsActiveFilter] = useState<boolean | undefined>()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  
  const { data, isLoading, error } = useServices(projectId, {
    search: search || undefined,
    type: typeFilter,
    isActive: isActiveFilter,
    limit: 50,
  })
  
  const services = data?.services || []
  const serviceTypes = [...new Set(services.map(s => s.type))]

  if (error) {
    return (
      <div className="text-center py-12">
        <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-medium mb-2">Failed to load services</h3>
        <p className="text-muted-foreground mb-6">
          {error.message || 'Unable to fetch services'}
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Services</h3>
          <p className="text-sm text-muted-foreground">
            Manage your deployable services and their dependencies
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Service
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <Select value={typeFilter || 'all-types'} onValueChange={(value) => setTypeFilter(value === 'all-types' ? undefined : value)}>
          <SelectTrigger className="w-[150px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-types">All Types</SelectItem>
            {serviceTypes.filter(type => type && type.trim() !== '').map(type => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select 
          value={isActiveFilter === undefined ? 'all-status' : isActiveFilter.toString()} 
          onValueChange={(value) => setIsActiveFilter(value === 'all-status' ? undefined : value === 'true')}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-status">All Status</SelectItem>
            <SelectItem value="true">Active Only</SelectItem>
            <SelectItem value="false">Inactive Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Services Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="text-center py-12">
          <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">
            {search || typeFilter || isActiveFilter !== undefined 
              ? 'No services found' 
              : 'No services yet'
            }
          </h3>
          <p className="text-muted-foreground mb-6">
            {search || typeFilter || isActiveFilter !== undefined
              ? 'Try adjusting your filters to see more results'
              : 'Add your first service to start deploying'
            }
          </p>
          {!search && !typeFilter && isActiveFilter === undefined && (
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Service
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {services.map(service => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
      )}

      {/* Create Service Dialog */}
      <CreateServiceDialog
        projectId={projectId}
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </div>
  )
}