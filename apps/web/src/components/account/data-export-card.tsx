'use client'

import { Download } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@deployer/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'

import { useExportSelfData } from '@/domains/user/hooks'

/**
 * "Download your data" (`AUTH-032`).
 *
 * The export describes the account and its credentials — sessions and API keys by metadata, never by secret. It is
 * scoped to the session server-side, so there is no id to tamper with.
 */
export function DataExportCard() {
    const exportData = useExportSelfData()

    const download = async () => {
        try {
            const result = await exportData.mutateAsync({})
            const blob = new Blob([JSON.stringify(result, null, 2)], {
                type: 'application/json',
            })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `deployer-account-${new Date().toISOString().slice(0, 10)}.json`
            link.click()
            URL.revokeObjectURL(url)
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : 'The export failed'
            )
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Download className="size-4" />
                    Your data
                </CardTitle>
                <CardDescription>
                    Everything this platform holds about you: the profile, the
                    sessions you are signed in on, and the API keys you minted —
                    by name and date, never by secret.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button
                    variant="outline"
                    onClick={() => void download()}
                    disabled={exportData.isPending}
                >
                    {exportData.isPending ? 'Preparing…' : 'Download your data'}
                </Button>
            </CardContent>
        </Card>
    )
}
