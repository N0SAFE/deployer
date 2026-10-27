import { $ZodIssue, $ZodIssueInvalidType } from 'zod/v4/core'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'
import { validateEnvSafe } from '#/env'
import RedirectAfterDelay from './RedirectAfterDelay'

import type { Metadata } from 'next'
function renderInvalidType(issue: $ZodIssueInvalidType) {
    // The received value may be a secret: only ever echo it in development.
    const showReceived = process.env.NODE_ENV === 'development'
    return (
        <div className="m-4 flex gap-4">
            {showReceived ? (
                <div className="flex justify-between gap-2">
                    <div className="text-muted-foreground text-sm">Received: </div>
                    <div className="text-destructive text-sm">
                        {JSON.stringify(issue.input)}
                    </div>
                </div>
            ) : null}
            <div className="flex justify-between gap-2">
                <div className="text-muted-foreground text-sm">Expected Type: </div>
                <div className="text-destructive text-sm">
                    {issue.expected}
                </div>
            </div>{' '}
        </div>
    )
}

function renderByCode(issue: $ZodIssue) {
    switch (issue.code) {
        case 'invalid_type':
            return renderInvalidType(issue)
        default:
            return null
    }
}

export default async function EnvPage(props: {
    searchParams: Promise<{ redirect?: string }>
}) {
    const searchParams = await props.searchParams
    const parsedEnv = validateEnvSafe(process.env)
    if (parsedEnv.success) {
        return (
            <div className="mt-12 flex flex-col items-center justify-center">
                <Card className="w-full max-w-sm">
                    <CardHeader className="text-center">
                        <CardTitle>Environment is Valid</CardTitle>
                        <CardDescription>The configuration looks correct. Taking you back…</CardDescription>
                    </CardHeader>
                </Card>
                <RedirectAfterDelay
                    delay={3000}
                    to={searchParams.redirect ?? '/'}
                />
            </div>
        )
    }
    const issues = parsedEnv.error.issues
    return (
        <div className="mt-12 flex flex-col items-center justify-center gap-4 px-4">
            <p className="text-muted-foreground max-w-md text-center text-sm">
                The platform cannot start because its configuration is invalid. Fix the
                variable(s) below in the server environment, then restart the web app.
            </p>
            {issues.map((issue, index) => (
                <Card key={index} className="w-full max-w-sm">
                    <CardHeader className="text-center">
                        <CardTitle className="text-destructive">
                            {issue.message}
                        </CardTitle>
                        <CardDescription>
                            {issue.path.join('.')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {renderByCode(issue)}
                        <div className="flex items-center justify-between pt-8">
                            <div className="text-muted-foreground text-sm">
                                Code: {issue.code}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}

export const metadata: Metadata = {
    title: "Configuration error",
    description: "Environment configuration failed",
}
