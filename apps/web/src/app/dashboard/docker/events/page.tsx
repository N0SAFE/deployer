import { redirect } from 'next/navigation'

import type { Metadata } from 'next'
export default function DashboardDockerEventsPage() {
  redirect('/dashboard/docker/activity')
}

export const metadata: Metadata = {
    title: "Docker events",
    description: "Live Docker daemon event stream",
}
