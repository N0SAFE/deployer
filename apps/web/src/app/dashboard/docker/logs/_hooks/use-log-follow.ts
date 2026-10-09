import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'
import { countNewLines, type IdentifiedLine } from '../_lib/merge-lines'

const BOTTOM_THRESHOLD_PX = 24

/**
 * Follow (tail -f) behaviour for a scrollable log viewport.
 *
 * While following, the viewport sticks to the newest line. Scrolling away, or
 * pausing, stops that and remembers the last line the operator had seen so the UI
 * can say "N new lines". Scrolling back to the bottom resumes following.
 */
export function useLogFollow(viewportRef: RefObject<HTMLDivElement | null>, lines: readonly IdentifiedLine[]) {
  const [following, setFollowing] = useState(true)
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const lastId = lines[lines.length - 1]?.id ?? null

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [viewportRef])

  const pause = useCallback(() => {
    setAnchorId(lastId)
    setFollowing(false)
  }, [lastId])

  const resume = useCallback(() => {
    setFollowing(true)
    setAnchorId(null)
    scrollToBottom()
  }, [scrollToBottom])

  const toggle = useCallback(() => {
    if (following) pause()
    else resume()
  }, [following, pause, resume])

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= BOTTOM_THRESHOLD_PX
    if (atBottom && !following) resume()
    else if (!atBottom && following) pause()
  }, [following, pause, resume, viewportRef])

  useLayoutEffect(() => {
    if (following) scrollToBottom()
  }, [following, lastId, lines.length, scrollToBottom])

  return {
    following,
    toggle,
    resume,
    onScroll,
    newLineCount: following ? 0 : countNewLines(lines, anchorId),
  }
}
