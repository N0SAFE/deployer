'use client'

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card';
import { ScrollArea } from '@repo/ui/components/shadcn/scroll-area';
import { Button } from '@repo/ui/components/shadcn/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog';
import { Badge } from '@repo/ui/components/shadcn/badge';
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert';
import { 
  Folder, 
  File, 
  ChevronDown, 
  ChevronRight, 
  Download, 
  Eye,
  AlertCircle,
  Loader2,
  Edit
} from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { TraefikConfigEditor } from './TraefikConfigEditor';
import { toast } from 'sonner';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: string;
  extension?: string;
  permissions?: string;
  isReadable?: boolean;
  isWritable?: boolean;
}

interface DirectoryItem {
  name: string;
  path: string;
  files: FileItem[];
  subdirectories: DirectoryItem[];
}

export default function TraefikFileSystemViewer() {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{ file: FileItem; projectName: string } | null>(null);
  const [viewFileDialog, setViewFileDialog] = useState(false);
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingFileContent, setLoadingFileContent] = useState(false);
  
  // TraefikConfigEditor state
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedServiceName, setSelectedServiceName] = useState<string>('');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');

  // Get list of all projects
  const { 
    data: projects, 
    isLoading: projectsLoading, 
    error: projectsError 
  } = useQuery(
    orpc.traefik.listProjects.queryOptions({
      input: {},
    })
  );

  // Get the complete file system structure
  const { 
    data: fileSystem, 
    isLoading: fileSystemLoading, 
    error: fileSystemError 
  } = useQuery(
    orpc.traefik.getFileSystem.queryOptions({
      input: {},
    })
  );

  // Check if any query is loading
  const isLoading = projectsLoading || fileSystemLoading;
  
  // Combine errors from all queries
  const error = projectsError || fileSystemError;

  const toggleDirectory = (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  // File content and download mutations
  const getFileContentMutation = useMutation(
    orpc.traefik.getFileContent.mutationOptions({
      onError: (error) => {
        console.error('Error loading file content:', error);
        toast.error('Failed to load file content');
      }
    })
  );
  
  // Force sync mutation for empty projects
  const forceSyncMutation = useMutation(
    orpc.traefik.forceSyncConfigs.mutationOptions({
      onSuccess: (result, variables) => {
        const { projectName } = variables;
        toast.success(`Sync completed for ${projectName}: ${result.successful}/${result.total} configs synced`);
        
        // Refetch the file system to show updated content
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      },
      onError: (error, variables) => {
        const { projectName } = variables;
        console.error(`Error syncing project ${projectName}:`, error);
        toast.error(`Failed to sync project ${projectName}`);
      }
    })
  );
  
  const downloadFileMutation = useMutation(
    orpc.traefik.downloadFile.mutationOptions({
      onError: (error) => {
        console.error('Error downloading file:', error);
        toast.error('Failed to download file');
      }
    })
  );

  const handleViewFile = async (file: FileItem, projectName: string) => {
    if (file.type !== 'file') return;
    
    setSelectedFile({ file, projectName });
    setViewFileDialog(true);
    setLoadingFileContent(true);
    
    try {
      const content = await getFileContentMutation.mutateAsync({ filePath: file.path });
      setFileContent(content.content);
    } catch (error) {
      console.error('Error loading file content:', error);
      setFileContent('Error loading file content');
    } finally {
      setLoadingFileContent(false);
    }
  };

  const handleDownloadFile = async (file: FileItem) => {
    if (file.type !== 'file') return;
    
    try {
      const response = await downloadFileMutation.mutateAsync({ filePath: file.path });
      
      // Create blob and download
      const blob = new Blob([response.content], { type: response.mimeType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast.success(`Downloaded ${file.name}`);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  };
  
  // Handle edit file - extract service ID from filename and open TraefikConfigEditor
  const handleEditFile = (file: FileItem) => {
    if (file.type !== 'file' || !file.name.includes('service-')) return;
    
    // Parse service ID from filename like "service-cae38621-b9ec5986.yml"
    const match = file.name.match(/^service-([\w-]+)-[\w-]+\.yml$/);
    if (match) {
      const serviceId = match[1];
      setSelectedServiceId(serviceId);
      setSelectedServiceName(`Service ${serviceId}`);
      setSelectedFilePath(file.path); // Pass the file path for loading content
      setConfigEditorOpen(true);
    } else {
      toast.error('Unable to extract service ID from filename');
    }
  };

  // Handle force sync for empty projects
  const handleSyncProject = async (projectName: string) => {
    toast.info(`Starting sync for project: ${projectName}`);
    await forceSyncMutation.mutateAsync({ projectName });
  };

  const renderDirectory = (directory: DirectoryItem, projectName: string, level = 0) => {
    const directoryKey = `${projectName}-${directory.path}`;
    const isExpanded = expandedDirs.has(directoryKey);
    const indent = level * 20;

    return (
      <div key={directoryKey}>
        <div 
          className="flex items-center py-2 px-2 hover:bg-gray-50 cursor-pointer rounded-md"
          style={{ marginLeft: `${indent}px` }}
        >
          <div 
            className="flex items-center flex-1"
            onClick={() => toggleDirectory(directoryKey)}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 mr-2 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 mr-2 text-gray-500" />
            )}
            <Folder className="w-4 h-4 mr-2 text-blue-500" />
            <span className="font-medium">{directory.name}</span>
            {level === 0 && (
              <Badge variant="outline" className="ml-2 text-xs">
                {projectName}
              </Badge>
            )}
          </div>
          
          {/* Show sync button for empty project directories */}
          {level === 0 && directory.path.includes('/dynamic/projects/') && 
           directory.files.length === 0 && directory.subdirectories.length === 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                handleSyncProject(directory.name);
              }}
              disabled={forceSyncMutation.isPending}
              className="ml-2 h-6 px-2 text-xs"
              title="Sync Traefik configurations for this project"
            >
              {forceSyncMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                'Sync'
              )}
            </Button>
          )}
        </div>
        
        {isExpanded && (
          <div>
            {directory.subdirectories.map(subdir => renderDirectory(subdir, projectName, level + 1))}
            {directory.files.map(file => renderFile(file, projectName, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderFile = (file: FileItem, projectName: string, level = 0) => {
    const indent = level * 20;
    
    return (
      <div key={`${projectName}-${file.path}`}>
        <div 
          className="flex items-center py-2 px-2 hover:bg-gray-50 rounded-md"
          style={{ marginLeft: `${indent}px` }}
        >
          <File className="w-4 h-4 mr-2 ml-6 text-gray-500" />
          <span>{file.name}</span>
          {file.size && (
            <Badge variant="outline" className="ml-2 text-xs">
              {formatFileSize(file.size)}
            </Badge>
          )}
          <div className="ml-auto flex gap-2">
            {file.name.includes('service-') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleEditFile(file)}
                className="h-8 w-8 p-0"
                title="Edit Traefik Configuration"
              >
                <Edit className="w-4 h-4" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleViewFile(file, projectName)}
              className="h-8 w-8 p-0"
              title="View File"
            >
              <Eye className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleDownloadFile(file)}
              className="h-8 w-8 p-0"
              title="Download File"
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        <span>Loading Traefik file systems...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Error loading file systems: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-bold">Traefik File System</h2>
          <p className="text-gray-600">
            Browse and manage all Traefik configuration files organized by projects
          </p>
        </div>

        {/* Project-Based File System View */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Configuration Files 
              <Badge variant="outline" className="text-xs">
                {projects?.length || 0} projects
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!projects || projects.length === 0 ? (
              <div className="flex items-center justify-center p-8 text-gray-500">
                <AlertCircle className="w-6 h-6 mr-2" />
                <span>No Traefik projects found</span>
              </div>
            ) : (
              <ScrollArea className="h-96">
                <div className="space-y-1">
                  {fileSystem && fileSystem.subdirectories.map((directory) => (
                    <div key={directory.name} className="space-y-1">
                      {renderDirectory(directory, directory.name)}
                    </div>
                  ))}
                  {fileSystem && fileSystem.files.map((file) => (
                    <div key={file.name} className="space-y-1">
                      {renderFile(file, "root")}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* File Content Dialog */}
      <Dialog open={viewFileDialog} onOpenChange={setViewFileDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedFile?.file.name}
              {selectedFile && (
                <Badge variant="outline" className="text-xs">
                  {selectedFile.projectName}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {loadingFileContent ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span>Loading file content...</span>
              </div>
            ) : (
              <ScrollArea className="h-96">
                <pre className="p-4 bg-gray-50 rounded-md text-sm font-mono whitespace-pre-wrap">
                  {fileContent}
                </pre>
              </ScrollArea>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => selectedFile && handleDownloadFile(selectedFile.file)}
              disabled={!selectedFile || loadingFileContent}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button
              variant="outline"
              onClick={() => setViewFileDialog(false)}
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Traefik Config Editor */}
      {selectedServiceId && (
        <TraefikConfigEditor
          serviceId={selectedServiceId}
          serviceName={selectedServiceName}
          isOpen={configEditorOpen}
          onClose={() => {
            setConfigEditorOpen(false);
            setSelectedServiceId(null);
            setSelectedServiceName('');
          }}
        />
      )}
    </div>
  );
}