import type { TaskPageProviderStateModel } from './use-task-page-provider-state'
import { useEffect } from 'react'
import { listLocalTasks } from '@/runtime/runtime-local-task-client'

type LocalLoadingInput = Pick<
  TaskPageProviderStateModel,
  | 'taskSource'
  | 'localTaskSourceProjectId'
  | 'localTasksRefreshNonce'
  | 'setLocalTasks'
  | 'setLocalTasksLoading'
  | 'setLocalTasksError'
>

// Why keyed on project id: switching projects must clear the previous
// project's tasks before the new load lands, or the board flashes stale rows.
export function useTaskPageLocalLoading<Model extends LocalLoadingInput>(model: Model): Model {
  const {
    taskSource,
    localTaskSourceProjectId,
    localTasksRefreshNonce,
    setLocalTasks,
    setLocalTasksLoading,
    setLocalTasksError
  } = model
  useEffect(() => {
    if (taskSource !== 'local') {
      return
    }
    if (!localTaskSourceProjectId) {
      setLocalTasks([])
      setLocalTasksLoading(false)
      setLocalTasksError(null)
      return
    }
    let cancelled = false
    setLocalTasks([])
    setLocalTasksLoading(true)
    setLocalTasksError(null)
    listLocalTasks(localTaskSourceProjectId).then(
      (tasks) => {
        if (cancelled) {
          return
        }
        setLocalTasks(tasks)
        setLocalTasksLoading(false)
      },
      (error: unknown) => {
        if (cancelled) {
          return
        }
        setLocalTasks([])
        setLocalTasksLoading(false)
        setLocalTasksError(error instanceof Error ? error.message : 'Failed to load local tasks')
      }
    )
    return () => {
      cancelled = true
    }
  }, [
    taskSource,
    localTaskSourceProjectId,
    localTasksRefreshNonce,
    setLocalTasks,
    setLocalTasksLoading,
    setLocalTasksError
  ])
  return model
}
