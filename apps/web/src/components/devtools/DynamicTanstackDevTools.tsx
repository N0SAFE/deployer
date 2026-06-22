'use client'

import { useEffect, useState, type ComponentType } from "react";

// Local props type - avoids importing from TanStackDevTools at compile time
// which would trigger the module graph and cause V8 crash
type TanStackDevToolsProps = Record<string, unknown>;

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

                setDevtoolsComponent(() => mod.TanStackDevTools as ComponentType<TanStackDevToolsProps>)
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
