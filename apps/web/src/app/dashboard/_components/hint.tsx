'use client'

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@deployer/ui/components/shadcn/tooltip'

import type { ReactNode } from 'react'

/** Keyboard-focusable wrapper that explains its child on hover/focus. */
export function Hint({
    content,
    children,
}: {
    content: ReactNode
    children: ReactNode
}) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        tabIndex={0}
                        className="focus-visible:outline-ring cursor-help rounded focus-visible:outline-2"
                    >
                        {children}
                    </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                    {content}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
