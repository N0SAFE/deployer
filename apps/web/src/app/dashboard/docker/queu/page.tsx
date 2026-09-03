import { redirect } from 'next/navigation'

import type { Metadata } from 'next'
export default function DashboardDockerQueuPageRedirect() {
  redirect('/dashboard/docker/activity')
}

export const metadata: Metadata = {
    title: "Docker queue",
    description: "Queued Docker operations",
}
