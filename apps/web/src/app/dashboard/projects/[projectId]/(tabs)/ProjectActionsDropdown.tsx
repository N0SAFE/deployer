'use client'

import { Button } from '@repo/ui/components/shadcn/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import {
    MoreHorizontal,
    ExternalLink,
    GitBranch,
    Users,
} from 'lucide-react'

export default function ProjectActionsDropdown() {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Domain
                </DropdownMenuItem>
                <DropdownMenuItem>
                    <GitBranch className="mr-2 h-4 w-4" />
                    Git Settings
                </DropdownMenuItem>
                <DropdownMenuItem>
                    <Users className="mr-2 h-4 w-4" />
                    Manage Team
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}