import { safe } from '@orpc/client'
import { redirect } from 'next/navigation'
import React from 'react'

import { SetupWizard } from '@deployer/ui/components/setup/setup-wizard'

import { setupApi } from '@/domains/setup/api'
import { setupEndpoints } from '@/domains/setup/endpoints'
import { getErrorMessage } from "@/lib/orpc/typed-errors";
import { Setup, AuthSignin } from '@/routes'

// ONE wizard implementation, shared with the API's own setup page. This page
// only supplies the web app's data access (the adapter).


import { ErrorScreen } from './_component/ErrorScreen';

import type { Metadata } from 'next'



export default Setup.Route(async ({ searchParams }) => {
    const [error, data] = await safe(setupEndpoints.getState.call())

    if (error !== null) {
        return (
            <ErrorScreen
                message={getErrorMessage(error, 'Unknown error')}
            />
        )
    }

    if (!data.needsSetup) {
        return redirect(AuthSignin({}, { redirectTo: searchParams.redirectTo ?? searchParams.callbackUrl }))
    }

    // Needs setup — render the wizard
    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-2xl">
                <SetupWizard api={setupApi} />
            </div>
        </div>
    )
})

export const metadata: Metadata = {
    title: 'Setup',
    description: 'Initial platform setup',
}
