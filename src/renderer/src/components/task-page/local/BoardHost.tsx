import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'
import { useTaskPageLocalMutations } from '../../use-task-page-local-mutations'
import { TaskPageLocalBoard } from './Board'
import type { LocalTask, LocalTaskStatus } from '../../../../../shared/local-task'

export function TaskPageLocalBoardHost({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const {
    localTasks,
    localTasksLoading,
    localTasksError,
    localTaskSourceProjectId,
    setLocalTasksRefreshNonce,
    setLocalTaskDialog,
    setSelectedLocalTask,
    openLocalDetailPage
  } = model
  const { refreshLocalTasks, moveLocalTask } = useTaskPageLocalMutations(model)
  const hasProject = localTaskSourceProjectId !== null
  const unreadable = localTasksError !== null

  const handleMove = (task: LocalTask, status: LocalTaskStatus): void => {
    setSelectedLocalTask(task)
    void moveLocalTask(task, status).catch(() => {
      // Rollback + toast already handled in the mutation; the board keeps stale state visible.
    })
  }

  return (
    <TaskPageLocalBoard
      tasks={localTasks}
      loading={localTasksLoading}
      unreadable={unreadable}
      hasProject={hasProject}
      onRetry={() => {
        setLocalTasksRefreshNonce((nonce) => nonce + 1)
        void refreshLocalTasks()
      }}
      onCreate={() => setLocalTaskDialog({ mode: 'create' })}
      onEdit={(task) => {
        setSelectedLocalTask(task)
        setLocalTaskDialog({ mode: 'edit', task })
      }}
      onDeleteRequest={(task) => {
        setSelectedLocalTask(task)
        setLocalTaskDialog({ mode: 'delete', task })
      }}
      onMove={handleMove}
      onOpenWorktree={(task) => {
        setSelectedLocalTask(task)
        openLocalDetailPage(task)
      }}
      pendingIds={new Set()}
    />
  )
}
