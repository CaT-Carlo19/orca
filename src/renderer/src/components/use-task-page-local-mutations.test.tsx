// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTaskPageLocalMutations } from './use-task-page-local-mutations'
import type { LocalTask } from '../../../shared/local-task'

const TASK: LocalTask = {
  id: 1,
  url: 'orca://local-task/v1/p/1',
  title: 'T',
  description: '',
  status: 'todo',
  createdAt: 1,
  updatedAt: 1
}

const clientMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn()
}))

vi.mock('@/runtime/runtime-local-task-client', () => ({
  listLocalTasks: clientMocks.list,
  createLocalTask: clientMocks.create,
  updateLocalTask: clientMocks.update,
  deleteLocalTask: clientMocks.remove
}))

function setup(tasks: LocalTask[] = [TASK]) {
  const setLocalTasks = vi.fn()
  const setLocalTasksLoading = vi.fn()
  const setLocalTasksError = vi.fn()
  const setLocalTasksRefreshNonce = vi.fn()
  const setLocalTaskDialog = vi.fn()
  const { result } = renderHook(() =>
    useTaskPageLocalMutations({
      taskSource: 'local',
      localTaskSourceProjectId: 'p',
      localTasks: tasks,
      setLocalTasks,
      setLocalTasksLoading,
      setLocalTasksError,
      setLocalTasksRefreshNonce,
      setLocalTaskDialog
    })
  )
  return { result, setLocalTasks, setLocalTasksLoading, setLocalTasksError, setLocalTaskDialog }
}

beforeEach(() => {
  vi.clearAllMocks()
  clientMocks.list.mockResolvedValue([])
})

describe('useTaskPageLocalMutations', () => {
  it('creates a task and refreshes the list', async () => {
    clientMocks.create.mockResolvedValue({ ...TASK, id: 2, title: 'New' })
    const { result } = setup([])
    let created: LocalTask | undefined
    await act(async () => {
      created = await result.current.createLocalTask({ title: 'New' })
    })
    expect(created?.id).toBe(2)
    expect(clientMocks.create).toHaveBeenCalledWith({ projectId: 'p', title: 'New' })
  })

  it('moves a task with optimistic patch and rolls back on failure', async () => {
    clientMocks.update.mockRejectedValueOnce(new Error('boom'))
    const { result, setLocalTasks } = setup()
    await act(async () => {
      await expect(result.current.moveLocalTask(TASK, 'done')).rejects.toThrow('boom')
    })
    const calls = setLocalTasks.mock.calls.map((call) => call[0] as LocalTask[])
    expect(calls[0][0].status).toBe('done')
    expect(calls.at(-1)).toEqual([TASK])
  })

  it('retries a move once on revision conflict then rolls back', async () => {
    clientMocks.update
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'revision-conflict' }))
      .mockResolvedValueOnce({ ...TASK, status: 'done' })
    const { result, setLocalTasks } = setup()
    let moved: LocalTask | undefined
    await act(async () => {
      moved = await result.current.moveLocalTask(TASK, 'done')
    })
    expect(moved?.status).toBe('done')
    expect(clientMocks.update).toHaveBeenCalledTimes(2)
    expect(setLocalTasks).toHaveBeenCalled()
  })

  it('deletes a task and prunes it from the list', async () => {
    clientMocks.remove.mockResolvedValue(true)
    const { result, setLocalTasks } = setup()
    let ok = false
    await act(async () => {
      ok = await result.current.deleteLocalTask(TASK)
    })
    expect(ok).toBe(true)
    expect(setLocalTasks).toHaveBeenCalledWith([])
  })
})
