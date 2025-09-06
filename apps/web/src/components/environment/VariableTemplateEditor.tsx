'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@repo/ui/components/shadcn/tabs'
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  Code,
  Eye,
  Search,
  RefreshCw,
  Lightbulb,
} from 'lucide-react'
import { type VariableResolutionContext, type VariableResolutionResult, type VariableTemplateParseResult } from '@repo/api-contracts/modules/variable-resolver'
import { VariableTemplateParser as RealVariableTemplateParser } from './variable-template-parser'

// Initialize the real parser
const variableTemplateParser = new RealVariableTemplateParser()

// Adapter to match the expected interface
const VariableTemplateParser = {
  parseTemplate: (template: string): VariableTemplateParseResult => {
    const result = variableTemplateParser.parseTemplate(template)
    return {
      isValid: result.isValid,
      originalValue: template,
      hasReferences: template.includes('${'),
      staticParts: result.isValid ? [template] : [],
      references: result.references.map(ref => ({
        type: ref.type === 'service' ? 'service' as const : 
              ref.type === 'project' ? 'project' as const : 
              ref.type === 'env' ? 'environment' as const : 'variable' as const,
        identifier: ref.name,
        property: ref.property,
        fullPath: ref.fullPath,
        raw: ref.raw,
        isEscaped: false,
        isExternal: false,
      })),
      errors: result.errors,
    }
  },
  
  resolveTemplate: async (template: string, context: VariableResolutionContext): Promise<VariableResolutionResult> => {
    try {
      // Adapt context to match parser expectations
      const adaptedContext = {
        services: context.services,
        projects: context.projects,
        env: context.environments,
      }
      const result = await variableTemplateParser.resolveTemplate(template, adaptedContext)
      return {
        success: result.success,
        resolvedValue: result.resolved,
        errors: result.errors.map(err => ({
          type: 'resolution_error' as const,
          message: err.message,
          reference: err.reference,
          raw: err.raw,
          error: err.message,
        })),
        warnings: [],
      }
    } catch (error) {
      return {
        success: false,
        resolvedValue: template,
        errors: [{
          type: 'resolution_error' as const,
          message: String(error),
          reference: template,
          raw: template,
          error: String(error),
        }],
        warnings: [],
      }
    }
  },
  
  validateTemplate: (template: string) => {
    return variableTemplateParser.validateTemplate(template)
  },
}

interface VariableTemplateEditorProps {
  initialTemplate?: string
  context?: Partial<VariableResolutionContext>
  onTemplateChange?: (template: string) => void
  onResolutionChange?: (result: VariableResolutionResult) => void
}

export function VariableTemplateEditor({
  initialTemplate = '',
  context = {},
  onTemplateChange,
  onResolutionChange,
}: VariableTemplateEditorProps) {
  const [template, setTemplate] = useState(initialTemplate)
  const [parseResult, setParseResult] = useState<ReturnType<typeof VariableTemplateParser.parseTemplate> | null>(null)
  const [resolutionResult, setResolutionResult] = useState<VariableResolutionResult | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [activeTab, setActiveTab] = useState('editor')

  // Mock context for testing
  const mockContext: VariableResolutionContext = {
    projectId: '1',
    environmentId: '1',
    projects: {
      '1': {
        id: '1',
        name: 'My Project',
        url: 'https://myproject.com',
        services: {
          api: { url: 'https://api.myproject.com', port: 3001 },
          web: { url: 'https://www.myproject.com', port: 3000 },
          database: { 
            connection: 'postgresql://localhost:5432/myproject',
            host: 'localhost',
            port: 5432,
            name: 'myproject'
          }
        }
      },
      '2': {
        id: '2',
        name: 'Another Project',
        url: 'https://another.com',
      }
    },
    services: {
      api: {
        id: 'api',
        name: 'API Service',
        url: 'https://api.myproject.com',
        port: 3001,
        healthCheck: '/health'
      },
      web: {
        id: 'web',
        name: 'Web Service',
        url: 'https://www.myproject.com',
        port: 3000
      }
    },
    environments: {
      '1': {
        id: '1',
        name: 'production',
        type: 'production',
        url: 'https://prod.myproject.com',
        domain: 'prod.myproject.com'
      },
      '2': {
        id: '2',
        name: 'staging',
        type: 'staging',
        url: 'https://staging.myproject.com',
        domain: 'staging.myproject.com'
      }
    },
    variables: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      API_VERSION: 'v1'
    },
    ...context,
  }

  // Parse template whenever it changes
  useEffect(() => {
    if (template) {
      const result = VariableTemplateParser.parseTemplate(template)
      setParseResult(result)
      onTemplateChange?.(template)
    } else {
      setParseResult(null)
    }
  }, [template, onTemplateChange])

  // Resolve template
  const handleResolve = async () => {
    if (!template || !parseResult) return

    setIsResolving(true)
    try {
      const result = await VariableTemplateParser.resolveTemplate(template, mockContext)
      setResolutionResult(result)
      onResolutionChange?.(result)
    } catch (error) {
      console.error('Resolution failed:', error)
      setResolutionResult({
        resolvedValue: template,
        success: false,
        errors: [{ 
          type: 'resolution_error' as const, 
          message: 'Resolution failed', 
          reference: 'system', 
          raw: template,
          error: 'Resolution failed' 
        }],
        warnings: [],
      })
    } finally {
      setIsResolving(false)
    }
  }

  // Template examples
  const examples = [
    {
      name: 'Simple Project Reference',
      template: '${projects.1.url}/api/v1',
      description: 'Reference a project URL with a static path'
    },
    {
      name: 'Service Configuration',
      template: 'DATABASE_URL=${projects.1.services.database.connection}',
      description: 'Reference nested service configuration'
    },
    {
      name: 'Environment-specific URL',
      template: 'https://${environments.1.domain}/api/${variables.API_VERSION}',
      description: 'Combine environment domain with variable'
    },
    {
      name: 'Complex Template',
      template: 'Connect to ${services.api.name} at ${services.api.url}:${services.api.port}${services.api.healthCheck}',
      description: 'Multiple references in a single template'
    },
  ]

  const validation = parseResult ? VariableTemplateParser.validateTemplate(template) : { isValid: true, errors: [] }

  return (
    <div className="w-full space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Variable Template Editor
          </CardTitle>
          <CardDescription>
            Create and test variable templates with dynamic resolution
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="editor">Editor</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="references">References</TabsTrigger>
              <TabsTrigger value="examples">Examples</TabsTrigger>
            </TabsList>

            {/* Template Editor */}
            <TabsContent value="editor" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="template">Variable Template</Label>
                <Textarea
                  id="template"
                  placeholder="Enter your variable template here... e.g., ${projects.myproject.url}/api"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="min-h-[120px] font-mono text-sm"
                />
                <div className="text-xs text-muted-foreground">
                  Supported references: ${'{'}projects.&lt;id&gt;.&lt;property&gt;{'}'}, ${'{'}services.&lt;id&gt;.&lt;property&gt;{'}'}, ${'{'}environments.&lt;id&gt;.&lt;property&gt;{'}'}, ${'{'}variables.&lt;name&gt;{'}'}
                </div>
              </div>

              {/* Validation Status */}
              {template && (
                <div className="flex items-center gap-2">
                  {validation.isValid ? (
                    <Badge variant="secondary" className="text-green-700 bg-green-50 border-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Valid Syntax
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" />
                      Invalid Syntax
                    </Badge>
                  )}
                  
                  {parseResult?.hasReferences && (
                    <Badge variant="outline">
                      <Search className="h-3 w-3 mr-1" />
                      {parseResult.references.length} Reference{parseResult.references.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  
                  <Button 
                    size="sm" 
                    onClick={handleResolve} 
                    disabled={!template || !validation.isValid || isResolving}
                  >
                    {isResolving ? (
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Eye className="h-3 w-3 mr-1" />
                    )}
                    Resolve
                  </Button>
                </div>
              )}

              {/* Validation Errors */}
              {validation.errors.length > 0 && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-red-800 text-sm font-medium mb-1">
                    <AlertCircle className="h-4 w-4" />
                    Validation Errors
                  </div>
                  <ul className="text-sm text-red-700 space-y-1">
                    {validation.errors.map((error, index) => (
                      <li key={index}>• {error.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>

            {/* Preview Tab */}
            <TabsContent value="preview" className="space-y-4">
              {resolutionResult ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Original Template</Label>
                    <div className="p-3 rounded-md bg-gray-50 border font-mono text-sm">
                      {template}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Resolved Value</Label>
                    <div className={`p-3 rounded-md border font-mono text-sm ${
                      resolutionResult.success 
                        ? 'bg-green-50 border-green-200 text-green-800' 
                        : 'bg-red-50 border-red-200 text-red-800'
                    }`}>
                      {resolutionResult.resolvedValue}
                    </div>
                  </div>

                  {/* Resolution Status */}
                  <div className="flex items-center gap-2">
                    {resolutionResult.success ? (
                      <Badge variant="secondary" className="text-green-700 bg-green-50 border-green-200">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Resolved Successfully
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Resolution Failed
                      </Badge>
                    )}
                  </div>

                  {/* Errors */}
                  {resolutionResult.errors.length > 0 && (
                    <div className="p-3 rounded-md bg-red-50 border border-red-200">
                      <div className="flex items-center gap-2 text-red-800 text-sm font-medium mb-2">
                        <AlertCircle className="h-4 w-4" />
                        Resolution Errors
                      </div>
                      <div className="space-y-2">
                        {resolutionResult.errors.map((error, index) => (
                          <div key={index} className="text-sm">
                            <div className="font-medium text-red-800">{error.reference}</div>
                            <div className="text-red-600 ml-4">{error.error}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {resolutionResult.warnings.length > 0 && (
                    <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200">
                      <div className="flex items-center gap-2 text-yellow-800 text-sm font-medium mb-2">
                        <AlertCircle className="h-4 w-4" />
                        Warnings
                      </div>
                      <div className="space-y-2">
                        {resolutionResult.warnings.map((warning, index) => (
                          <div key={index} className="text-sm">
                            <div className="font-medium text-yellow-800">{warning.reference}</div>
                            <div className="text-yellow-600 ml-4">{warning.warning}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Enter a template and click &ldquo;Resolve&rdquo; to see the preview</p>
                </div>
              )}
            </TabsContent>

            {/* References Tab */}
            <TabsContent value="references" className="space-y-4">
              {parseResult?.hasReferences ? (
                <div className="space-y-4">
                  <div className="grid gap-4">
                    {parseResult.references.map((reference, index) => (
                      <Card key={index} className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{reference.type}s.{reference.identifier}.{reference.property}</div>
                            <div className="text-sm text-muted-foreground">
                              {reference.type === 'project' && 'References project configuration'}
                              {reference.type === 'service' && 'References service configuration'}
                              {reference.type === 'environment' && 'References environment configuration'}
                            </div>
                          </div>
                          <Badge variant="outline" className="capitalize">
                            {reference.type}
                          </Badge>
                        </div>
                      </Card>
                    ))}
                  </div>

                  <div className="p-4 rounded-md bg-blue-50 border border-blue-200">
                    <div className="flex items-center gap-2 text-blue-800 text-sm font-medium mb-2">
                      <Search className="h-4 w-4" />
                      Dependencies Found
                    </div>
                    <div className="text-sm text-blue-700">
                      This template references {parseResult.references.length} external value{parseResult.references.length !== 1 ? 's' : ''}.
                      Make sure all referenced projects, services, and environments exist.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No variable references found in template</p>
                  <p className="text-sm">Add references like ${'{'}projects.myproject.url{'}'} to see them here</p>
                </div>
              )}
            </TabsContent>

            {/* Examples Tab */}
            <TabsContent value="examples" className="space-y-4">
              <div className="space-y-4">
                {examples.map((example, index) => (
                  <Card key={index} className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{example.name}</h4>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => {
                            setTemplate(example.template)
                            setActiveTab('editor')
                          }}
                        >
                          Use Example
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">{example.description}</p>
                      <div className="p-2 rounded bg-gray-50 font-mono text-sm">
                        {example.template}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              <div className="p-4 rounded-md bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2 text-amber-800 text-sm font-medium mb-2">
                  <Lightbulb className="h-4 w-4" />
                  Template Tips
                </div>
                <ul className="text-sm text-amber-700 space-y-1">
                  <li>• Use ${'{'}projects.id.property{'}'} to reference project data</li>
                  <li>• Use ${'{'}services.id.property{'}'} to reference service configuration</li>
                  <li>• Use ${'{'}environments.id.property{'}'} to reference environment settings</li>
                  <li>• Use ${'{'}variables.name{'}'} to reference environment variables</li>
                  <li>• Combine multiple references in a single template</li>
                  <li>• Test your templates before using them in production</li>
                </ul>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}