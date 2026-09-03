"use client"

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@repo/ui/components/shadcn/alert";
import { Card, CardContent, CardHeader } from "@repo/ui/components/shadcn/card";
import { useRouter } from "next/navigation";

export function ErrorScreen({
    message,
}: {
    message: string
}) {
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
                    <Button className="mt-4 w-full" onClick={() => router.refresh()}>
                        Retry
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
}