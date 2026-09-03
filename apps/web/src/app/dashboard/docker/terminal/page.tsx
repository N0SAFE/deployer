import { redirect } from 'next/navigation'

import type { Metadata } from 'next'
export default function DashboardDockerTerminalPage() {
  redirect('/dashboard/docker/shell')
}

export const metadata: Metadata = {
    title: "Docker terminal",
    description: "Container terminal sessions",
}
