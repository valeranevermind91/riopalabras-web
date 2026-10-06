import { useQueueStatus, showUnsavedNotice } from '../data/useQueueStatus'
import type { WriteQueue } from '../data/writeQueue'
import { strings } from '../strings'
import { Notice } from './Notice'

/**
 * Progress is waiting in the write queue and its retries ran out (or the server refused it). The one visible sign of
 * being offline: nothing else in the app waits for, or reports on, the network. Shown until the queue drains, then it goes away by itself.
 */
export function UnsavedNotice({ queue }: { queue: WriteQueue }) {
  const status = useQueueStatus(queue)
  if (!showUnsavedNotice(status)) return null
  return (
    <Notice actionLabel={strings.home.retryNow} onAction={() => void queue.retry()}>
      {status.authRejected ? strings.home.signInRejected : strings.home.unsavedProgress}
    </Notice>
  )
}
