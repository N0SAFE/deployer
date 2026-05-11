'use client'

import { useEffect, useState, type ComponentType } from "react";
import type { TanStackDevToolsProps } from "./TanStackDevTools";

export const DynamicTanstackDevTools = () => {
    const [DevtoolsComponent, setDevtoolsComponent] = useState<ComponentType<TanStackDevToolsProps> | null>(null)

    useEffect(() => {
        if (process.env.NODE_ENV !== 'development') {
            return
        }

        let isMounted = true

        void import('./TanStackDevTools')
            .then((mod) => {
                if (!isMounted) {
                    return
                }

                setDevtoolsComponent(() => mod.TanStackDevTools)
            })
            .catch(() => {
                // Keep app functional if devtools chunk fails to load.
                if (isMounted) {
                    setDevtoolsComponent(null)
                }
            })

        return () => {
            isMounted = false
        }
    }, [])

    if (process.env.NODE_ENV !== 'development' || !DevtoolsComponent) {
        return null
    }

    return <DevtoolsComponent />
}