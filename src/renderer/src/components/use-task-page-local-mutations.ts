import { useCallback } from 'react'
import type { LocalTask, LocalTaskStatus } from '../../../shared/local-task'
import {
  listLocalTasks,
  createLocalTask,
  updateLocalTask,
  deleteLocalTask
} from '@/runtime/runtime-local-task-client'

type LocalMutationsInput = {
  taskSource: string
  localTaskSourceProjectId: string | null
  localTasks: LocalTask[]
  setLocalTasks: (tasks: LocalTask[]) => void
  setLocalTasksLoading: (loading: boolean) => void
  setLocalTasksError: (error: string | null) => void
  setLocalTasksRefreshNonce: (updater: (nonce: number) => number) => void
  setLocalTaskDialog: (dialog: null) => void
}

function isRevisionConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'revision-conflict'
  )
}

// Why single retry: two racing writers converge on the second attempt; a
// hotter domain means a real contention loop the UI must surface, not spin on.
export function useTaskPageLocalMutations(model: LocalMutationsInput) {
  const {
    taskSource,
    localTaskSourceProjectId,
    localTasks,
    setLocalTasks,
    setLocalTasksLoading,
    setLocalTasksError,
    setLocalTasksRefreshNonce,
    setLocalTaskDialog
  } = model

  const refreshLocalTasks = useCallback(async () => {
    if (taskSource !== 'local' || !localTaskSourceProjectId) {
      return
    }
    setLocalTasksLoading(true)
    setLocalTasksError(null)
    try {
      setLocalTasks(await listLocalTasks(localTaskSourceProjectId))
    } catch (error: unknown) {
      setLocalTasksError(error instanceof Error ? error.message : 'Failed to load local tasks')
    } finally {
      setLocalTasksLoading(false)
    }
  }, [
    localTaskSourceProjectId,
    setLocalTasks,
    setLocalTasksError,
    setLocalTasksLoading,
    taskSource
  ])

  const createLocalTaskMutation = useCallback(
    async (input: { title: string; description?: string; status?: LocalTaskStatus }) => {
      if (!localTaskSourceProjectId) {
        throw new Error('No active project for local tasks')
      }
      const created = await createLocalTask({ projectId: localTaskSourceProjectId, ...input })
      setLocalTasksRefreshNonce((nonce) => nonce + 1)
      setLocalTaskDialog(null)
      await refreshLocalTasks()
      return created
    },
    [localTaskSourceProjectId, refreshLocalTasks, setLocalTaskDialog, setLocalTasksRefreshNonce]
  )

  const moveLocalTask = useCallback(
    async (task: LocalTask, status: LocalTaskStatus) => {
      if (!localTaskSourceProjectId) {
        throw new Error('No active project for local tasks')
      }
      const previous = localTasks
      const optimistic: LocalTask = { ...task, status, updatedAt: Date.now() }
      setLocalTasks(localTasks.map((entry) => (entry.id === task.id ? optimistic : entry)))
      try {
        return await updateLocalTask({
          projectId: localTaskSourceProjectId,
          id: task.id,
          status
        }).then((updated) => updated ?? optimistic)
      } catch (error: unknown) {
        if (isRevisionConflict(error)) {
          try {
            const retried = await updateLocalTask({
              projectId: localTaskSourceProjectId,
              id: task.id,
              status
            })
            return retried ?? optimistic
          } catch (retryError: unknown) {
            setLocalTasks(previous)
            throw retryError
          }
        }
        setLocalTasks(previous)
        throw error
      }
    },
    [localTaskSourceProjectId, localTasks, setLocalTasks]
  )

  const deleteLocalTaskMutation = useCallback(
    async (task: LocalTask) => {
      if (!localTaskSourceProjectId) {
        throw new Error('No active project for local tasks')
      }
      const ok = await deleteLocalTask(localTaskSourceProjectId, task.id)
      if (ok) {
        setLocalTasks(localTasks.filter((entry) => entry.id !== task.id))
      }
      return ok
    },
    [localTaskSourceProjectId, localTasks, setLocalTasks]
  )

  return {
    refreshLocalTasks,
    createLocalTask: createLocalTaskMutation,
    moveLocalTask,
    deleteLocalTask: deleteLocalTaskMutation
  }
}
