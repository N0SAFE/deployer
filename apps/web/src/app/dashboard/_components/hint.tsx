'use client'

import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@repo/ui/components/shadcn/tooltip'

/** Keyboard-focusable wrapper that explains its child on hover/focus. */
export function Hint({ content, children }: { content: ReactNode; children: ReactNode }) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<span tabIndex={0} className="cursor-help rounded focus-visible:outline-2 focus-visible:outline-ring">
						{children}
					</span>
				</TooltipTrigger>
				<TooltipContent className="max-w-xs text-xs">{content}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
