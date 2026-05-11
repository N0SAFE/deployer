import { validateEnvPath } from '#/env'
import { AppLogger, type LogData } from '@repo/logger'

const WEB_CONTEXT_FILTER_ENV_VAR = 'NEXT_PUBLIC_APP_DEBUG_CONTEXT_FILTER'
const WEB_CONTEXT_FILTER_VALUE = validateEnvPath(
  process.env.NEXT_PUBLIC_APP_DEBUG_CONTEXT_FILTER,
  'NEXT_PUBLIC_APP_DEBUG_CONTEXT_FILTER',
)
const webLogger = new AppLogger('web')

export type ContextFilterDebugPredicate<TContext extends LogData = LogData> = (
  lastData: TContext | undefined,
  currentData: TContext,
) => boolean

export type ContextFilterDebugLogger = (methodName: string, context?: LogData) => void

export function createContextFilterDebugLogger(
  defaultClassName: string,
  channel: string,
): ContextFilterDebugLogger {
  const scopedWebLogger = webLogger.scope(defaultClassName)

  const contextFilterLogger = scopedWebLogger.createContextFilterLogger({
    defaultClassName,
    filterEnvVar: WEB_CONTEXT_FILTER_ENV_VAR,
    filterValue: WEB_CONTEXT_FILTER_VALUE,
    channel,
  })

  return (methodName: string, context?: LogData) => {
    contextFilterLogger.debug(methodName, context)
  }
}
