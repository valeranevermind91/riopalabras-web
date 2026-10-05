import { useSyncExternalStore } from 'react'
import type { QueueStatus, WriteQueue } from './writeQueue'

export function useQueueStatus(queue: WriteQueue): QueueStatus {
  return useSyncExternalStore(queue.subscribe, queue.getStatus, queue.getStatus)
}

/** Home's "progress hasn't been saved yet" notice: on while the queue is stuck, gone as soon as it drains. */
export function showUnsavedNotice(status: Pick<QueueStatus, 'stuck'>): boolean {
  return status.stuck
}
