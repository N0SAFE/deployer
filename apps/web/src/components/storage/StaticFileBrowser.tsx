'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Input } from '@repo/ui/components/shadcn/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import {
  Folder,
  Download,
  Eye,
  Search,
  RefreshCw,
  ExternalLink,
  Globe,
  Clock,
  FileText,
  Image as ImageIcon,
  Code,
  Package,
  Archive,
  Music,
  Video,
  FileX,
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'

interface StaticFileBrowserProps {
  serviceId: string
  serviceName?: string
}

interface StaticFileInfo {
  filePath: string
  size: number
  lastModified: string
  contentType: string
  etag: string
  isDirectory: boolean
}

const getFileIcon = (contentType: string, fileName: string) => {
  if (contentType.startsWith('image/')) return <ImageIcon className="h-4 w-4 text-green-600" />
  if (contentType.startsWith('video/')) return <Video className="h-4 w-4 text-red-600" />
  if (contentType.startsWith('audio/')) return <Music className="h-4 w-4 text-purple-600" />
  if (contentType.includes('javascript') || fileName.endsWith('.js') || fileName.endsWith('.ts') || fileName.endsWith('.tsx') || fileName.endsWith('.jsx')) {
    return <Code className="h-4 w-4 text-yellow-600" />
  }
  if (contentType.includes('json') || fileName.endsWith('.json')) return <Package className="h-4 w-4 text-blue-600" />
  if (contentType.includes('html') || fileName.endsWith('.html')) return <Globe className="h-4 w-4 text-orange-600" />
  if (contentType.includes('css') || fileName.endsWith('.css')) return <FileText className="h-4 w-4 text-blue-500" />
  if (contentType.includes('zip') || contentType.includes('tar') || contentType.includes('gzip')) {
    return <Archive className="h-4 w-4 text-gray-600" />
  }
  if (contentType.startsWith('text/')) return <FileText className="h-4 w-4 text-gray-500" />
  return <FileX className="h-4 w-4 text-gray-400" />
}

const formatBytes = (bytes: number) => {
  const sizes = ['B', 'KB', 'MB', 'GB']
  if (bytes === 0) return '0 B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString()
}

export default function StaticFileBrowser({ serviceId, serviceName }: StaticFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [previewFile, setPreviewFile] = useState<StaticFileInfo | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)

  // List static files
  const { data: filesData, isLoading, refetch } = useQuery(
    orpc.storage.listStaticFiles.queryOptions({
      input: {
        serviceId,
        path: currentPath === '/' ? undefined : currentPath,
      },
      staleTime: 30000, // 30 seconds
    })
  )

  // Get serving stats
  const { data: stats } = useQuery(
    orpc.storage.getStaticServingStats.queryOptions({
      input: {
        serviceId,
      },
      staleTime: 60000, // 1 minute
    })
  )

  const files = filesData?.files || []
  const directories = filesData?.directories || []
  const totalCount = filesData?.totalCount || 0

  // Filter files based on search
  const filteredFiles = files.filter(file => {
    const fileName = file.filePath.split('/').pop() || file.filePath
    return fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
           file.contentType.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const filteredDirectories = directories.filter(dir =>
    dir.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const navigateToPath = (path: string) => {
    setCurrentPath(path)
    setSearchQuery('') // Clear search when navigating
  }

  const goUp = () => {
    const pathParts = currentPath.split('/').filter(Boolean)
    if (pathParts.length > 0) {
      pathParts.pop()
      const newPath = pathParts.length > 0 ? '/' + pathParts.join('/') : '/'
      navigateToPath(newPath)
    }
  }

  const previewFileContent = async (file: StaticFileInfo) => {
    if (file.size > 1024 * 1024) { // 1MB limit for preview
      toast.error('File too large for preview')
      return
    }

    // For now, skip actual content loading since we need to figure out the correct ORPC method
    // Just show file info
    setPreviewFile(file)
    setPreviewContent(`File information:
Path: ${file.filePath}
Content Type: ${file.contentType}
Size: ${formatBytes(file.size)}
Last Modified: ${new Date(file.lastModified).toLocaleString()}
ETag: ${file.etag}`)
    
    /*
    try {
      // TODO: Fix ORPC method call once we know the correct pattern
      const response = await orpc.storage.getStaticFile.mutate({
        serviceId,
        filePath: file.filePath,
      })
      
      setPreviewFile(file)
      setPreviewContent(response.content)
    } catch (error) {
      toast.error('Failed to load file for preview')
      console.error(error)
    }
    */
  }

  const downloadFile = (file: StaticFileInfo) => {
    // Create download URL - this would need to be implemented based on your static serving setup
    const downloadUrl = `/api/storage/static/${serviceId}/${file.filePath}`
    const fileName = file.filePath.split('/').pop() || file.filePath
    
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getBreadcrumbs = () => {
    if (currentPath === '/') return [{ name: 'Root', path: '/' }]
    
    const parts = currentPath.split('/').filter(Boolean)
    const breadcrumbs = [{ name: 'Root', path: '/' }]
    
    let currentBreadcrumbPath = ''
    parts.forEach(part => {
      currentBreadcrumbPath += '/' + part
      breadcrumbs.push({
        name: part,
        path: currentBreadcrumbPath,
      })
    })
    
    return breadcrumbs
  }

  return (
    <div className="space-y-6">
      {/* Header with stats */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Static Files - {serviceName || serviceId}
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Browse and manage static files served by this service
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        {stats && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{stats.totalFiles}</p>
                <p className="text-sm text-gray-600">Total Files</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{formatBytes(stats.totalSize)}</p>
                <p className="text-sm text-gray-600">Total Size</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-600">{stats.requestCount || 0}</p>
                <p className="text-sm text-gray-600">Request Count</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-orange-600">{stats.cacheHitRate ? `${Math.round(stats.cacheHitRate * 100)}%` : 'N/A'}</p>
                <p className="text-sm text-gray-600">Cache Hit Rate</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Navigation and controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Breadcrumb navigation */}
            <div className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-1 text-sm">
                {getBreadcrumbs().map((breadcrumb, index) => (
                  <div key={breadcrumb.path} className="flex items-center gap-1">
                    <Button
                      variant={breadcrumb.path === currentPath ? "default" : "ghost"}
                      size="sm"
                      onClick={() => navigateToPath(breadcrumb.path)}
                    >
                      {breadcrumb.name}
                    </Button>
                    {index < getBreadcrumbs().length - 1 && <span>/</span>}
                  </div>
                ))}
              </div>
              {currentPath !== '/' && (
                <Button variant="outline" size="sm" onClick={goUp}>
                  ↑ Up
                </Button>
              )}
            </div>

            {/* Search and view controls */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-gray-400" />
                <Input
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-40"
                />
              </div>
              <Select value={viewMode} onValueChange={(value: 'list' | 'grid') => setViewMode(value)}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list">List</SelectItem>
                  <SelectItem value="grid">Grid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Files display */}
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">Loading files...</p>
            </div>
          ) : filteredDirectories.length === 0 && filteredFiles.length === 0 ? (
            <div className="text-center py-8">
              <Folder className="h-16 w-16 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-semibold mb-2">
                {searchQuery ? 'No files found' : 'No files in this directory'}
              </h3>
              <p className="text-gray-600">
                {searchQuery 
                  ? `No files match "${searchQuery}"`
                  : 'This directory appears to be empty'
                }
              </p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4' : 'space-y-2'}>
              {/* Directories */}
              {filteredDirectories.map((directory) => (
                <div
                  key={directory}
                  className={`${
                    viewMode === 'grid'
                      ? 'p-4 border rounded-lg hover:bg-gray-50 cursor-pointer'
                      : 'flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer'
                  }`}
                  onClick={() => navigateToPath(`${currentPath}/${directory}`.replace('//', '/'))}
                >
                  <div className="flex items-center gap-2">
                    <Folder className="h-5 w-5 text-blue-600" />
                    <span className="font-medium">{directory}</span>
                  </div>
                  <Badge variant="outline">Directory</Badge>
                </div>
              ))}

              {/* Files */}
              {filteredFiles.map((file) => {
                const fileName = file.filePath.split('/').pop() || file.filePath
                return (
                <div
                  key={file.filePath}
                  className={`${
                    viewMode === 'grid'
                      ? 'p-4 border rounded-lg hover:bg-gray-50'
                      : 'flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50'
                  }`}
                >
                  <div className={`flex items-center gap-2 ${viewMode === 'grid' ? 'flex-col text-center' : 'flex-1'}`}>
                    {getFileIcon(file.contentType, fileName)}
                    <div className={viewMode === 'grid' ? 'text-center' : 'flex-1'}>
                      <p className="font-medium truncate">{fileName}</p>
                      <div className={`text-sm text-gray-500 ${viewMode === 'grid' ? 'mt-1' : 'flex items-center gap-4'}`}>
                        <span>{formatBytes(file.size)}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(file.lastModified)}
                        </span>
                      </div>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {file.contentType}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className={`flex items-center gap-1 ${viewMode === 'grid' ? 'mt-2' : ''}`}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => previewFileContent(file)}
                      disabled={file.size > 1024 * 1024}
                      title={file.size > 1024 * 1024 ? 'File too large for preview' : 'Preview file'}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadFile(file)}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/api/storage/static/${serviceId}/${file.filePath}`, '_blank')}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                )
              })}
            </div>
          )}

          {/* File count footer */}
          {totalCount > 0 && (
            <div className="mt-4 pt-4 border-t text-sm text-gray-600 text-center">
              Showing {filteredDirectories.length + filteredFiles.length} of {totalCount} items
              {searchQuery && (
                <span> matching &quot;{searchQuery}&quot;</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* File Preview Modal */}
      {previewFile && (
        <Dialog open={!!previewFile} onOpenChange={() => {
          setPreviewFile(null)
          setPreviewContent(null)
        }}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {getFileIcon(previewFile.contentType, previewFile.filePath.split('/').pop() || previewFile.filePath)}
                {previewFile.filePath.split('/').pop() || previewFile.filePath}
              </DialogTitle>
              <DialogDescription>
                {formatBytes(previewFile.size)} • {previewFile.contentType}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-96 overflow-auto">
              {previewContent ? (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <pre className="text-sm whitespace-pre-wrap">
                    {previewContent}
                  </pre>
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => downloadFile(previewFile)}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button
                onClick={() => window.open(`/api/storage/static/${serviceId}/${previewFile.filePath}`, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in New Tab
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}