'use client'

import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { usePathname } from 'next/navigation'
import { ReactElement } from 'react'

export default function ProjectTabsList({
    tabSections,
}: {
    tabSections: { label: string; path: string; link: ReactElement }[]
}) {
    const pathname = usePathname()
    const getActiveTab = () => {
        let section = tabSections.find((section) => section.path === pathname)
        if (!section) {
            tabSections.forEach((s) => {
                if (pathname.includes(s.path)) {
                    section = s
                }
            })
        }
        return section?.path || ''
    }

    return (
        <Tabs value={getActiveTab()} className="space-y-4">
            <TabsList>
                {tabSections.map((section) => (
                    <TabsTrigger
                        asChild
                        value={section.path}
                        key={section.path}
                    >
                        {section.link}
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    )
}
