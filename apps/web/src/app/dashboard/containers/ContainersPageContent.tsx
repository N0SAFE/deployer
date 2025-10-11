'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card';
import { Button } from '@repo/ui/components/shadcn/button';
import { Badge } from '@repo/ui/components/shadcn/badge';
import { Input } from '@repo/ui/components/shadcn/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select';
import { AlertCircle, Clock, Play, Square, RotateCcw, Trash2, Search, Filter } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';
import { ContainerInfo } from '@repo/api-contracts';

interface ContainerCardProps {
  container: ContainerInfo;
  onAction: (containerId: string, action: 'start' | 'stop' | 'restart' | 'remove') => void;
  isActioning: boolean;
}

function ContainerCard({ container, onAction, isActioning }: ContainerCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'stopped': return 'bg-gray-500';
      case 'failed': return 'bg-red-500';
      case 'starting': return 'bg-yellow-500';
      case 'stopping': return 'bg-orange-500';
      default: return 'bg-gray-500';
    }
  };

  const getHealthColor = (isHealthy: boolean) => {
    return isHealthy ? 'text-green-600' : 'text-red-600';
  };

  const formatBytes = (bytes: number | undefined) => {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatUptime = (uptime: number) => {
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-3 h-3 rounded-full ${getStatusColor(container.status)}`} />
            <div>
              <CardTitle className="text-lg">{container.containerName}</CardTitle>
              <CardDescription>{container.serviceName} • {container.projectName}</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={`capitalize ${getHealthColor(container.health.isHealthy)}`}>
            {container.health.isHealthy ? 'Healthy' : 'Unhealthy'}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Status</div>
            <div className="font-medium capitalize">{container.status}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Environment</div>
            <div className="font-medium capitalize">{container.environment}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Uptime</div>
            <div className="font-medium">{formatUptime(container.health.uptime)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Restarts</div>
            <div className="font-medium">{container.health.restartCount}</div>
          </div>
        </div>

        {container.health.resources && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">CPU Usage</div>
              <div className="font-medium">
                {container.health.resources.cpuUsage 
                  ? `${container.health.resources.cpuUsage.toFixed(1)}%` 
                  : 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Memory</div>
              <div className="font-medium">
                {formatBytes(container.health.resources.memoryUsage)}
                {container.health.resources.memoryLimit && 
                  ` / ${formatBytes(container.health.resources.memoryLimit)}`}
              </div>
            </div>
          </div>
        )}

        <div className="text-sm">
          <div className="text-muted-foreground">Created</div>
          <div className="font-medium">
            {formatDistanceToNow(new Date(container.metadata.createdAt), { addSuffix: true })}
          </div>
          {container.metadata.triggeredBy && (
            <>
              <div className="text-muted-foreground mt-2">Triggered by</div>
              <div className="font-medium">
                {container.metadata.triggeredBy} ({container.metadata.triggerType})
              </div>
            </>
          )}
        </div>

        <div className="flex space-x-2 pt-2">
          {container.status === 'stopped' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction(container.containerId, 'start')}
              disabled={isActioning}
            >
              <Play className="w-4 h-4 mr-1" />
              Start
            </Button>
          )}
          {container.status === 'running' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction(container.containerId, 'stop')}
              disabled={isActioning}
            >
              <Square className="w-4 h-4 mr-1" />
              Stop
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(container.containerId, 'restart')}
            disabled={isActioning}
          >
            <RotateCcw className="w-4 h-4 mr-1" />
            Restart
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onAction(container.containerId, 'remove')}
            disabled={isActioning}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ContainersPageContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [serviceFilter, setServiceFilter] = useState(searchParams.get('service') || '');
  const [projectFilter, setProjectFilter] = useState(searchParams.get('project') || '');
  const [actioningContainer, setActioningContainer] = useState<string | null>(null);

  // Query for containers list
  const { data: containersData, isLoading, error } = useQuery(orpc.deployment.listContainers.queryOptions({
    input: {
      status: statusFilter === 'all' ? undefined : statusFilter as 'running' | 'stopped' | 'failed',
      service: serviceFilter || undefined,
      project: projectFilter || undefined,
      limit: 50,
      offset: 0,
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  }));

  // Mutation for container actions
  const containerActionMutation = useMutation(orpc.deployment.containerAction.mutationOptions({
    onMutate: ({ containerId }) => {
      setActioningContainer(containerId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
    onSettled: () => {
      setActioningContainer(null);
    },
  }));

  const handleContainerAction = (containerId: string, action: 'start' | 'stop' | 'restart' | 'remove') => {
    containerActionMutation.mutate({ containerId, action });
  };

  // Filter containers based on search term
  const filteredContainers = containersData?.containers.filter((container: ContainerInfo) =>
    container.containerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    container.serviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    container.projectName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading containers...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Failed to load containers</h3>
            <p className="text-muted-foreground">
              {error instanceof Error ? error.message : 'An unexpected error occurred'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {containersData?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{containersData.summary.totalContainers}</div>
              <div className="text-sm text-muted-foreground">Total Containers</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-green-600">{containersData.summary.runningContainers}</div>
              <div className="text-sm text-muted-foreground">Running</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-gray-600">{containersData.summary.stoppedContainers}</div>
              <div className="text-sm text-muted-foreground">Stopped</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-red-600">{containersData.summary.failedContainers}</div>
              <div className="text-sm text-muted-foreground">Failed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-blue-600">{containersData.summary.healthyContainers}</div>
              <div className="text-sm text-muted-foreground">Healthy</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Filter className="w-5 h-5 mr-2" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  placeholder="Search containers..."
                  value={searchTerm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Service name..."
              value={serviceFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setServiceFilter(e.target.value)}
              className="w-40"
            />
            <Input
              placeholder="Project name..."
              value={projectFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectFilter(e.target.value)}
              className="w-40"
            />
          </div>
        </CardContent>
      </Card>

      {/* Containers Grid */}
      {filteredContainers.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No containers found</h3>
              <p className="text-muted-foreground">
                Try adjusting your filters or deploy some services to see containers here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredContainers.map((container: ContainerInfo) => (
            <ContainerCard
              key={container.containerId}
              container={container}
              onAction={handleContainerAction}
              isActioning={actioningContainer === container.containerId}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {containersData?.pagination && containersData.pagination.hasMore && (
        <Card>
          <CardContent className="flex items-center justify-center py-6">
            <Button variant="outline">
              Load More Containers
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}