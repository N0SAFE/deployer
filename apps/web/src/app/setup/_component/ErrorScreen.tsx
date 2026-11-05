'use client'

import { useRouter } from 'next/navigation'

import { Alert, AlertDescription } from '@deployer/ui/components/shadcn/alert'
import {
    Card,
    CardContent,
    CardHeader,
} from '@deployer/ui/components/shadcn/card'

import { Button } from '@/components/ui/button'

export function ErrorScreen({ message }: { message: string }) {
    const router = useRouter()

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <Card className="w-full max-w-lg">
                <CardHeader>
                    <h2 className="text-xl font-semibold">
                        Unable to check setup status
                    </h2>
                </CardHeader>
                <CardContent>
                    <Alert variant="destructive">
                        <AlertDescription>{message}</AlertDescription>
                    </Alert>
                    <Button
                        className="mt-4 w-full"
                        onClick={() => {
                            router.refresh()
                        }}
                    >
                        Retry
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
}
