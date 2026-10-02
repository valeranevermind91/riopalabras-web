import { useSyncExternalStore } from 'react'
import type { QueueStatus, WriteQueue } from './writeQueue'

export function useQueueStatus(queue: WriteQueue): QueueStatus {
  return useSyncExternalStore(queue.subscribe, queue.getStatus)
}
