'use client'

import { useState } from 'react'
import { CheckCircle2, Database, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { useMeshTestNodeConfigDb } from '@/domains/mesh/hooks'

interface TestResult {
  connected: boolean
  isNewDatabase?: boolean | null
  error?: string | null
}

/** Probes a PostgreSQL URL without saving it, so a typo never reaches the node's config file. */
export function DatabaseTestCard() {
  const testDb = useMeshTestNodeConfigDb()
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<TestResult | null>(null)

  const run = async () => {
    if (!url.trim()) return
    try {
      const res = await testDb.mutateAsync({ databaseUrl: url.trim() })
      setResult(res)
      if (res.connected) toast.success('Database connection successful')
      else toast.error(res.error ?? 'Connection failed')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      setResult({ connected: false, error: message })
      toast.error(`Database test failed: ${message}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Database className="size-5 text-primary" /> Test a database URL</CardTitle>
        <CardDescription>
          Checks that this node can reach a PostgreSQL database. Nothing is saved — paste the URL here before putting it in the configuration file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="node-test-db-url" className="text-xs text-muted-foreground">Database URL</Label>
          <div className="flex gap-2">
            <Input
              id="node-test-db-url"
              type="password"
              autoComplete="off"
              className="flex-1 font-mono text-xs"
              value={url}
              onChange={(e) => { setUrl(e.target.value) }}
              placeholder="postgresql://user:pass@host:5432/db"
            />
            <Button size="sm" onClick={() => void run()} disabled={testDb.isPending || !url.trim()}>
              {testDb.isPending ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
        </div>
        {result ? (
          <div className={`space-y-1 rounded-lg border p-3 ${result.connected ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'}`}>
            <div className="flex items-center gap-2">
              {result.connected ? <CheckCircle2 className="size-4 text-green-500" /> : <XCircle className="size-4 text-red-500" />}
              <p className={`text-sm font-semibold ${result.connected ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {result.connected ? 'Connection successful' : 'Connection failed'}
              </p>
            </div>
            {result.isNewDatabase !== null && result.isNewDatabase !== undefined ? (
              <p className="ml-6 text-sm text-muted-foreground">{result.isNewDatabase ? 'Fresh database (no existing data)' : 'Existing database with data'}</p>
            ) : null}
            {result.error ? <p className="ml-6 font-mono text-xs text-red-600 dark:text-red-400">{result.error}</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
