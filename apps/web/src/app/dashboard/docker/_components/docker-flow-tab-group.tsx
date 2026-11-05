'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface DockerFlowTabItem<T extends string> {
    value: T
    label: string
    icon: LucideIcon
    badge?: ReactNode
}

interface DockerFlowTabGroupProps<T extends string> {
    tabs: readonly DockerFlowTabItem<T>[]
    activeTab: T
    onTabChange: (tab: T) => void
}

export function DockerFlowTabGroup<T extends string>({
    tabs,
    activeTab,
    onTabChange,
}: DockerFlowTabGroupProps<T>) {
    return (
        <div className="bg-muted/10 flex shrink-0 items-center gap-2 overflow-x-auto border-b px-1">
            {tabs.map((tab, index) => {
                const Icon = tab.icon

                return (
                    <div key={tab.value} className="contents">
                        <button
                            type="button"
                            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === tab.value ? 'border-primary text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent'}`}
                            onClick={() => {
                                onTabChange(tab.value)
                            }}
                        >
                            <Icon className="h-4 w-4" />
                            {tab.label}
                            {tab.badge}
                        </button>

                        {index < tabs.length - 1 ? (
                            <span className="text-muted-foreground/60">→</span>
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}
