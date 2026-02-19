'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import {
    Save,
    RotateCcw,
} from 'lucide-react'

export function ConfigurationActions() {
    const [hasUnsavedChanges] = useState(false)

    return (
        <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
                <Button variant="outline" size="sm">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset Changes
                </Button>
            )}
            <Button size="sm" disabled={!hasUnsavedChanges}>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
            </Button>
        </div>
    )
}