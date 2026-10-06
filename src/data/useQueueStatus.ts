import { useSyncExternalStore } from 'react'
import type { QueueStatus, WriteQueue } from './writeQueue'

export function useQueueStatus(queue: WriteQueue): QueueStatus {
  return useSyncExternalStore(queue.subscribe, queue.getStatus, queue.getStatus)
}

/**
 * Home's "progress hasn't been saved yet" notice: on while the queue is stuck, and as soon as the server refuses a write
 * for who is asking (even a metrics one), gone when a write is accepted again.
 */
export function showUnsavedNotice(status: Pick<QueueStatus, 'stuck' | 'authRejected'>): boolean {
  return status.stuck || status.authRejected
}
