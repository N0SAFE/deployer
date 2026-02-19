'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { 
  HardDrive, 
  File, 
  Folder,
  Upload,
  Download,
  Trash2,
  FolderPlus,
  Copy,
  Move,
  Archive,
  Database,
  Calendar,
  Clock,
  Globe,
  Package,
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'
import FileUploadComponent from './FileUploadComponent'
import StaticFileBrowser from './StaticFileBrowser'

// Type definitions based on API contracts
export default function StorageDashboard() {
  const [activeTab, setActiveTab] = useState('files')
  const [currentPath, setCurrentPath] = useState('/')
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const queryClient = useQueryClient()

  // Files List
  const { data: files = [], isLoading: filesLoading } = useQuery(
    orpc.storage.listFiles.queryOptions({
      input: {
        path: currentPath,
        limit: 100,
        offset: 0,
      },
      staleTime: 30000, // 30 seconds
    })
  )

  // Storage Usage
  const { data: usage } = useQuery(
    orpc.storage.getUsage.queryOptions({
      input: {},
      staleTime: 60000, // 1 minute
    })
  )

  // Storage Metrics
  const { data: metrics, isLoading: metricsLoading } = useQuery(
    orpc.storage.getMetrics.queryOptions({
      input: {
        timeRange: '24h',
        granularity: 'hour',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Backups List
  const { data: backups = [], isLoading: backupsLoading } = useQuery(
    orpc.storage.listBackups.queryOptions({
      input: {
        limit: 20,
        offset: 0,
      },
      staleTime: 30000, // 30 seconds
    })
  )

  // Quotas List
  const { data: quotas = [], isLoading: quotasLoading } = useQuery(
    orpc.storage.listQuotas.queryOptions({
      input: {},
      staleTime: 60000, // 1 minute
    })
  )

  // Create Directory Mutation
  const createDirectoryMutation = useMutation(
    orpc.storage.createDirectory.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: { path: currentPath } }) })
        toast.success('Directory created successfully')
        setCreateFolderOpen(false)
      },
      onError: (error: Error) => {
        toast.error(`Failed to create directory: ${error.message}`)
      },
    })
  )

  // Upload File Mutation
  const uploadFileMutation = useMutation(
    orpc.storage.uploadFile.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: { path: currentPath } }) })
        queryClient.invalidateQueries({ queryKey: orpc.storage.getUsage.queryKey({ input: {} }) })
        toast.success('File uploaded successfully')
        setUploadDialogOpen(false)
      },
      onError: (error: Error) => {
        toast.error(`Failed to upload file: ${error.message}`)
      },
    })
  )

  // Delete File Mutation
  const deleteFileMutation = useMutation(
    orpc.storage.deleteFile.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: { path: currentPath } }) })
        queryClient.invalidateQueries({ queryKey: orpc.storage.getUsage.queryKey({ input: {} }) })
        toast.success('File deleted successfully')
      },
      onError: (error: Error) => {
        toast.error(`Failed to delete file: ${error.message}`)
      },
    })
  )

  // Create Backup Mutation
  const createBackupMutation = useMutation(
    orpc.storage.createBackup.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.storage.listBackups.queryKey({ input: {} }) })
        toast.success('Backup initiated successfully')
      },
      onError: (error: Error) => {
        toast.error(`Failed to create backup: ${error.message}`)
      },
    })
  )

  // Delete Backup Mutation
  const deleteBackupMutation = useMutation(
    orpc.storage.deleteBackup.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.storage.listBackups.queryKey({ input: {} }) })
        toast.success('Backup deleted successfully')
      },
      onError: (error: Error) => {
        toast.error(`Failed to delete backup: ${error.message}`)
      },
    })
  )

  // Cleanup Storage Mutation
  const cleanupMutation = useMutation(
    orpc.storage.cleanup.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.storage.getUsage.queryKey({ input: {} }) })
        queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: { path: currentPath } }) })
        toast.success('Storage cleanup completed')
      },
      onError: (error: Error) => {
        toast.error(`Failed to cleanup storage: ${error.message}`)
      },
    })
  )

  const formatBytes = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    if (bytes === 0) return '0 B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
  }

  const handleCreateDirectory = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    
    createDirectoryMutation.mutate({
      path: `${currentPath}/${formData.get('name') as string}`.replace('//', '/'),
    })
  }

  const handleFileUpload = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const fileInput = formData.get('file') as File
    
    if (fileInput && fileInput.size > 0) {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const content = e.target?.result as string
        uploadFileMutation.mutate({
          path: `${currentPath}/${fileInput.name}`.replace('//', '/'),
          content: content.split(',')[1], // Remove data URL prefix
          overwrite: false,
        })
      }
      reader.readAsDataURL(fileInput)
    }
  }

  const navigateToPath = (path: string) => {
    setCurrentPath(path)
  }

  const usagePercentage = usage && Array.isArray(usage) && usage.length > 0 ? (usage[0].used / usage[0].total) * 100 : 0

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <HardDrive className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Storage Management
              </h1>
              <p className="text-gray-600">
                Manage files, backups, and storage quotas across your infrastructure
              </p>
            </div>
          </div>
          <Button onClick={() => cleanupMutation.mutate({ paths: [currentPath] })} variant="outline" disabled={cleanupMutation.isPending}>
            <Trash2 className="h-4 w-4 mr-2" />
            {cleanupMutation.isPending ? 'Cleaning...' : 'Cleanup Storage'}
          </Button>
        </div>

        {/* Storage Usage Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <HardDrive className="h-8 w-8 text-blue-600" />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Storage Used</p>
                  <p className="text-2xl font-bold">{usage && Array.isArray(usage) && usage.length > 0 ? formatBytes(usage[0].used) : '-'}</p>
                  {usage && Array.isArray(usage) && usage.length > 0 && (
                    <div className="mt-2">
                      <Progress value={usagePercentage} className="h-2" />
                      <p className="text-xs text-gray-500 mt-1">
                        {formatBytes(usage[0].available)} available
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <File className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-gray-600">Total Files</p>
                  <p className="text-2xl font-bold">{metrics?.topFiles?.length || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Database className="h-8 w-8 text-purple-600" />
                <div>
                  <p className="text-sm text-gray-600">Backups</p>
                  <p className="text-2xl font-bold">{Array.isArray(backups) ? backups.length : (backups?.backups?.length || '-')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Upload className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-sm text-gray-600">Today&apos;s Uploads</p>
                  <p className="text-2xl font-bold">{metrics?.ioStats?.writeOps || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="files" className="flex items-center gap-2">
            <File className="h-4 w-4" />
            Files
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="static" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Static Files
          </TabsTrigger>
          <TabsTrigger value="backups" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Backups
          </TabsTrigger>
          <TabsTrigger value="quotas" className="flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Quotas
          </TabsTrigger>
          <TabsTrigger value="metrics" className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Metrics
          </TabsTrigger>
        </TabsList>

        {/* Files Tab */}
        <TabsContent value="files" className="space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">File Management</h2>
              <Badge variant="outline">{currentPath}</Badge>
            </div>
            <div className="flex gap-2">
              <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <FolderPlus className="h-4 w-4 mr-2" />
                    New Folder
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Folder</DialogTitle>
                    <DialogDescription>
                      Create a new directory in {currentPath}
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreateDirectory} className="space-y-4">
                    <div>
                      <Label htmlFor="name">Folder Name</Label>
                      <Input id="name" name="name" placeholder="my-folder" required />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createDirectoryMutation.isPending}>
                        {createDirectoryMutation.isPending ? 'Creating...' : 'Create Folder'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>

              <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload File
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Upload File</DialogTitle>
                    <DialogDescription>
                      Upload a file to {currentPath}
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleFileUpload} className="space-y-4">
                    <div>
                      <Label htmlFor="file">Select File</Label>
                      <Input id="file" name="file" type="file" required />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => setUploadDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={uploadFileMutation.isPending}>
                        {uploadFileMutation.isPending ? 'Uploading...' : 'Upload File'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Breadcrumb Navigation */}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => navigateToPath('/')}
              className={currentPath === '/' ? 'bg-gray-100' : ''}
            >
              Root
            </Button>
            {currentPath !== '/' && currentPath.split('/').filter(Boolean).map((segment, index, array) => {
              const fullPath = '/' + array.slice(0, index + 1).join('/')
              return (
                <div key={fullPath} className="flex items-center gap-2">
                  <span>/</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => navigateToPath(fullPath)}
                    className={fullPath === currentPath ? 'bg-gray-100' : ''}
                  >
                    {segment}
                  </Button>
                </div>
              )
            })}
          </div>

          {/* Files List */}
          <div className="grid gap-3">
            {filesLoading ? (
              <div className="text-center py-8">Loading files...</div>
            ) : files.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <File className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Files Found</h3>
                  <p className="text-gray-600 mb-4">Upload files or create folders to get started</p>
                  <div className="flex gap-2 justify-center">
                    <Button onClick={() => setCreateFolderOpen(true)} variant="outline">
                      <FolderPlus className="h-4 w-4 mr-2" />
                      New Folder
                    </Button>
                    <Button onClick={() => setUploadDialogOpen(true)}>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload File
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              files.map((file) => (
                <Card key={file.path} className="hover:bg-gray-50">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div 
                        className="flex items-center gap-3 flex-1 cursor-pointer"
                        onClick={() => file.type === 'directory' ? navigateToPath(file.path) : null}
                      >
                        {file.type === 'directory' ? (
                          <Folder className="h-5 w-5 text-blue-600" />
                        ) : (
                          <File className="h-5 w-5 text-gray-600" />
                        )}
                        <div className="flex-1">
                          <h3 className="font-medium">{file.name}</h3>
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            {file.type !== 'directory' && (
                              <span>{formatBytes(file.size)}</span>
                            )}
                            <span>{new Date(file.lastModified).toLocaleDateString()}</span>
                            <span>{file.type}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {file.type !== 'directory' && (
                          <Button size="sm" variant="outline">
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="sm" variant="outline">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline">
                          <Move className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive"
                          onClick={() => deleteFileMutation.mutate({ path: file.path })}
                          disabled={deleteFileMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* File Upload Tab */}
        <TabsContent value="upload" className="space-y-6">
          <FileUploadComponent 
            onUploadComplete={(result) => {
              toast.success(`Successfully uploaded: ${result.fileName}`)
              // Optionally refresh other data
              queryClient.invalidateQueries({ queryKey: orpc.storage.getUsage.queryKey({ input: {} }) })
            }}
            projectId="current-project" // You can make this dynamic
          />
        </TabsContent>

        {/* Static File Browser Tab */}
        <TabsContent value="static" className="space-y-6">
          <StaticFileBrowser 
            serviceId="demo-service" // You can make this dynamic
            serviceName="Demo Service"
          />
        </TabsContent>

        {/* Backups Tab */}
        <TabsContent value="backups" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Database Backups</h2>
            <Button 
              onClick={() => createBackupMutation.mutate({ 
                databaseName: 'main',
                compression: true,
              })}
              disabled={createBackupMutation.isPending}
            >
              <Database className="h-4 w-4 mr-2" />
              {createBackupMutation.isPending ? 'Creating...' : 'Create Backup'}
            </Button>
          </div>

          <div className="grid gap-4">
            {backupsLoading ? (
              <div className="text-center py-8">Loading backups...</div>
            ) : (Array.isArray(backups) ? backups.length : (backups?.backups?.length || 0)) === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Database className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Backups Found</h3>
                  <p className="text-gray-600 mb-4">Create your first database backup to get started</p>
                  <Button onClick={() => createBackupMutation.mutate({ 
                    databaseName: 'main',
                    compression: true,
                  })}>
                    <Database className="h-4 w-4 mr-2" />
                    Create Backup
                  </Button>
                </CardContent>
              </Card>
            ) : (
              (Array.isArray(backups) ? backups : backups?.backups || []).map((backup) => (
                <Card key={backup.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Database className="h-5 w-5 text-purple-600" />
                        <div>
                          <h3 className="font-semibold">{backup.databaseName}</h3>
                          <p className="text-sm text-gray-600">{backup.metadata?.description || 'No description'}</p>
                          <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(backup.startedAt).toLocaleDateString()}
                            </span>
                            <span>{formatBytes(backup.size)}</span>
                            <Badge variant={backup.status === 'completed' ? 'default' : 'secondary'}>
                              {backup.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline">
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                        <Button size="sm" variant="outline">
                          Restore
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive"
                          onClick={() => deleteBackupMutation.mutate({ backupId: backup.id })}
                          disabled={deleteBackupMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Quotas Tab */}
        <TabsContent value="quotas" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Storage Quotas</h2>
            <Button>
              <HardDrive className="h-4 w-4 mr-2" />
              Create Quota
            </Button>
          </div>

          <div className="grid gap-4">
            {quotasLoading ? (
              <div className="text-center py-8">Loading quotas...</div>
            ) : quotas.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <HardDrive className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Quotas Configured</h3>
                  <p className="text-gray-600 mb-4">Set up storage quotas to manage resource usage</p>
                  <Button>
                    <HardDrive className="h-4 w-4 mr-2" />
                    Create Quota
                  </Button>
                </CardContent>
              </Card>
            ) : (
              quotas.map((quota, index) => (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <HardDrive className="h-5 w-5 text-blue-600" />
                        <div className="flex-1">
                          <h3 className="font-semibold">{quota.path}</h3>
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span>Limit: {formatBytes(quota.hardLimit)}</span>
                            <span>Used: {formatBytes(quota.currentUsage)}</span>
                            <Badge variant={quota.currentUsage / quota.hardLimit > 0.8 ? 'destructive' : 'default'}>
                              {Math.round((quota.currentUsage / quota.hardLimit) * 100)}% used
                            </Badge>
                          </div>
                          <Progress value={(quota.currentUsage / quota.hardLimit) * 100} className="mt-2 h-2" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline">
                          Edit
                        </Button>
                        <Button size="sm" variant="destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Metrics Tab */}
        <TabsContent value="metrics" className="space-y-6">
          <h2 className="text-xl font-semibold">Storage Metrics</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Upload Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {metricsLoading ? (
                  <div className="text-center py-4">Loading...</div>
                ) : metrics ? (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Today&apos;s Uploads:</span>
                      <Badge>{metrics.ioStats?.writeOps || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>This Week:</span>
                      <Badge variant="secondary">{metrics.ioStats?.readOps || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Files:</span>
                      <Badge variant="outline">{metrics.topFiles?.length || 0}</Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-4">No metrics available</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {metricsLoading ? (
                  <div className="text-center py-4">Loading...</div>
                ) : metrics ? (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Avg Upload Speed:</span>
                      <Badge>{Math.round((metrics.ioStats?.writeBytes || 0) / 1024 / 1024)} MB/s</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Download Speed:</span>
                      <Badge variant="secondary">{Math.round((metrics.ioStats?.readBytes || 0) / 1024 / 1024)} MB/s</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Storage Efficiency:</span>
                      <Badge variant="outline">{Math.round((metrics.diskUsage?.[0]?.used || 0) / (metrics.diskUsage?.[0]?.total || 1) * 100) || '-'}%</Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-4">No metrics available</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}