'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Search, Plus, Loader2, RefreshCw, Filter, Grid, List } from 'lucide-react'
import { orpc } from '@/lib/orpc'
import StackCard from './StackCard'
import CreateStackDialog from './CreateStackDialog'

interface StackListProps {
  projectId: string
}

type ViewMode = 'grid' | 'list'
type Environment = 'all' | 'development' | 'staging' | 'production'
type StackStatus = 'all' | 'running' | 'stopped' | 'error' | 'starting' | 'stopping'

interface StackFilters {
  search: string
  environment: Environment
  status: StackStatus
}

export default function StackList({ projectId }: StackListProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filters, setFilters] = useState<StackFilters>({
    search: '',
    environment: 'all',
    status: 'all'
  })

  // Query for stacks
  const { 
    data: stacksResponse, 
    isLoading, 
    error, 
    refetch, 
    isFetching 
  } = useQuery(orpc.orchestration.listStacks.queryOptions({
    input: { projectId }
  }))

  // Extract stacks from response
  const stacks = stacksResponse?.data || []

  const handleFilterChange = (key: keyof StackFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const clearFilters = () => {
    setFilters({
      search: '',
      environment: 'all',
      status: 'all'
    })
  }

  // Filter stacks based on current filters
  const filteredStacks = Array.isArray(stacks) ? stacks.filter(stack => {
    const matchesSearch = !filters.search || 
      stack.name?.toLowerCase().includes(filters.search.toLowerCase()) ||
      stack.id?.toLowerCase().includes(filters.search.toLowerCase())
    
    const matchesEnvironment = filters.environment === 'all' || 
      stack.environment === filters.environment
    
    const matchesStatus = filters.status === 'all' || 
      stack.status === filters.status

    return matchesSearch && matchesEnvironment && matchesStatus
  }) : []

  const handleStackAction = () => {
    // Refetch the stack list when any action is performed
    refetch()
  }

  const handleStackCreated = () => {
    // Refetch the stack list when a new stack is created
    refetch()
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">
            <p className="font-semibold">Failed to load stacks</p>
            <p className="text-sm text-gray-500 mt-1">
              {error instanceof Error ? error.message : 'Unknown error occurred'}
            </p>
            <Button 
              onClick={() => refetch()} 
              className="mt-4"
              variant="outline"
              size="sm"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Docker Stacks</h2>
          <p className="text-gray-600">Manage your deployment stacks</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            onClick={() => refetch()} 
            variant="outline" 
            size="sm"
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          
          <CreateStackDialog 
            projectId={projectId}
            onSuccess={handleStackCreated}
          />
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center">
              <Filter className="h-4 w-4 mr-2" />
              Filters
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button 
                onClick={clearFilters} 
                variant="ghost" 
                size="sm"
                className="text-xs"
              >
                Clear All
              </Button>
              <div className="flex border rounded-md">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="rounded-r-none"
                >
                  <Grid className="h-3 w-3" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="rounded-l-none"
                >
                  <List className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search stacks..."
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Environment Filter */}
            <Select 
              value={filters.environment} 
              onValueChange={(value: Environment) => handleFilterChange('environment', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Environment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Environments</SelectItem>
                <SelectItem value="development">Development</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select 
              value={filters.status} 
              onValueChange={(value: StackStatus) => handleFilterChange('status', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="starting">Starting</SelectItem>
                <SelectItem value="stopping">Stopping</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Active Filters Display */}
          {(filters.search || filters.environment !== 'all' || filters.status !== 'all') && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
              {filters.search && (
                <Badge variant="secondary">
                  Search: {filters.search}
                </Badge>
              )}
              {filters.environment !== 'all' && (
                <Badge variant="secondary">
                  Environment: {filters.environment}
                </Badge>
              )}
              {filters.status !== 'all' && (
                <Badge variant="secondary">
                  Status: {filters.status}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stack List/Grid */}
      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="p-8">
              <div className="flex flex-col items-center justify-center text-gray-500">
                <Loader2 className="h-8 w-8 animate-spin mb-4" />
                <p className="font-medium">Loading stacks...</p>
                <p className="text-sm">Please wait while we fetch your deployment stacks</p>
              </div>
            </CardContent>
          </Card>
        ) : filteredStacks.length === 0 ? (
          <Card>
            <CardContent className="p-8">
              <div className="text-center text-gray-500">
                {Array.isArray(stacks) && stacks.length === 0 ? (
                  // No stacks at all
                  <>
                    <div className="bg-gray-50 rounded-full p-4 w-16 h-16 flex items-center justify-center mx-auto mb-4">
                      <Plus className="h-8 w-8 text-gray-400" />
                    </div>
                    <p className="font-semibold text-lg">No stacks yet</p>
                    <p className="text-sm mt-1 mb-4">
                      Get started by creating your first deployment stack
                    </p>
                    <CreateStackDialog 
                      projectId={projectId}
                      onSuccess={handleStackCreated}
                      trigger={
                        <Button>
                          <Plus className="h-4 w-4 mr-2" />
                          Create Your First Stack
                        </Button>
                      }
                    />
                  </>
                ) : (
                  // Stacks exist but filtered out
                  <>
                    <div className="bg-gray-50 rounded-full p-4 w-16 h-16 flex items-center justify-center mx-auto mb-4">
                      <Search className="h-8 w-8 text-gray-400" />
                    </div>
                    <p className="font-semibold">No stacks match your filters</p>
                    <p className="text-sm mt-1 mb-4">
                      Try adjusting your search criteria or clearing the filters
                    </p>
                    <Button onClick={clearFilters} variant="outline">
                      Clear Filters
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Results Count */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Showing {filteredStacks.length} of {Array.isArray(stacks) ? stacks.length : 0} stacks
              </p>
            </div>

            {/* Stack Cards */}
            <div className={
              viewMode === 'grid' 
                ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6'
                : 'space-y-4'
            }>
              {filteredStacks.map((stack) => (
                <StackCard
                  key={stack.id}
                  stack={stack}
                  onEdit={(stackId) => {
                    // TODO: Implement edit functionality
                    console.log('Edit stack:', stackId)
                  }}
                  onScale={(stackId) => {
                    // TODO: Implement scale functionality
                    console.log('Scale stack:', stackId)
                    handleStackAction()
                  }}
                  onRemove={(stackId) => {
                    // TODO: Implement remove functionality
                    console.log('Remove stack:', stackId)
                    handleStackAction()
                  }}
                  onViewLogs={(stackId) => {
                    // TODO: Implement view logs functionality
                    console.log('View logs for stack:', stackId)
                  }}
                  onViewDetails={(stackId) => {
                    // TODO: Implement view details functionality
                    console.log('View details for stack:', stackId)
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}