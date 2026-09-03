import { getErrorMessage } from "@/lib/orpc/typed-errors";
import React from 'react'
import { redirect } from 'next/navigation'
import { Setup, AuthSignin } from '@/routes'
import { SetupWizard } from '@/components/setup/setup-wizard'

import type { Metadata } from 'next'
import { safe } from '@orpc/client'
import { setupEndpoints } from '@/domains/setup/endpoints'
import { ErrorScreen } from './_component/ErrorScreen';

export default Setup.Route(async ({ searchParams }) => {
    const [error, data, isDefined] = await safe(setupEndpoints.getState.call())
    
    console.log(error)

    if (error !== null) {
        if (isDefined) {
            return (
                <ErrorScreen
                    message={getErrorMessage(error, 'Unknown error')}
                />
            )
        }
        return (
            <ErrorScreen
                message={getErrorMessage(error, 'Unknown error')}
            />
        )
    }
    
    if (data.needsSetup === false) {
        return redirect(AuthSignin({}, { redirectTo: searchParams.redirectTo ?? searchParams.callbackUrl }))
    }

    // Needs setup — render the wizard
    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-2xl">
                <SetupWizard />
            </div>
        </div>
    )
})

export const metadata: Metadata = {
    title: 'Setup',
    description: 'Initial platform setup',
}
