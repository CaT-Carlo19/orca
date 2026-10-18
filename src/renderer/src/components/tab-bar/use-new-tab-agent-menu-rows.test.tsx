// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  STRUCTURED_AGENT_SESSION_AVAILABILITY_RUNTIME_CAPABILITY as AVAILABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY as CHAT,
  STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY as CLIENT,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY as CATALOG
} from '../../../../shared/protocol-version'
const mocks = vi.hoisted(() => ({ support: vi.fn(), subscribe: vi.fn(), publishing: false }))
vi.mock('@/runtime/runtime-rpc-subscribe', () => ({ subscribeRuntimeRpc: mocks.subscribe }))
vi.mock('@/lib/structured-agent-session-host-admission', () => ({
  askHostCreateSupport: mocks.support
}))
// Like the real hook: a closed menu acquires nothing, and the stored inventory stays.
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: (target: unknown) => ({
    detectedIds: target === undefined ? null : ['claude', 'codex', 'opencode']
  })
}))
vi.mock('@/runtime/local-runtime-capabilities', () => ({
  readLocalRuntimeCapabilitiesOrUnknown: () => null,
  subscribeLocalRuntimeCapabilitiesKnown: () => () => {}
}))
vi.mock('@/runtime/host-structured-agents', () => ({
  readHostStructuredAgents: () =>
    ['claude', 'codex', 'opencode'].map((agent) => ({ agent, capabilities: {} })),
  hostStructuredAgentsVersion: () => 0,
  subscribeHostStructuredAgents: () => () => {}
}))
vi.mock('@/lib/agent-launch-route-input', () => ({
  workspaceKindForWorktreeId: () => 'git-worktree',
  buildAgentLaunchRouteInput: (_state: unknown, { agent }: { agent: string }) => ({
    agent,
    executionHostId: 'local',
    hostCapabilities: [CHAT, CLIENT, CATALOG, ...(mocks.publishing ? [AVAILABILITY] : [])],
    clientCapabilities: [CHAT, CLIENT],
    hostStructuredAgents: ['claude', 'codex', 'opencode']
  })
}))
import { useNewTabAgentMenuRows } from './use-new-tab-agent-menu-rows'
const initial = useAppStore.getState()
beforeEach(() => {
  mocks.support.mockReset()
  mocks.subscribe.mockReset().mockResolvedValue({ unsubscribe: () => {} })
  useAppStore.setState({
    ...initial,
    activeWorktreeId: 'one',
    settings: {
      ...getDefaultSettings('/home/me'),
      experimentalNativeChat: true,
      disabledTuiAgents: []
    },
    localDetectedAgentIdsByContext: { host: ['claude', 'codex'] },
    detectedAgentIds: ['claude', 'codex', 'opencode']
  })
})
afterEach(cleanup)

it("reads a publishing host's one snapshot, holding a placeholder only until it lands", async () => {
  mocks.publishing = true
  const hook = renderHook(({ id }) => useNewTabAgentMenuRows(id, false, { kind: 'local' }), {
    initialProps: { id: 'one' }
  })
  const row = (agent: string) => hook.result.current.rows.find((r) => r.agent === agent)
  // Held while the workspace is shown, so the first open already knows.
  expect(mocks.subscribe).toHaveBeenCalledTimes(1)
  expect(mocks.subscribe.mock.calls[0][2]).toEqual({})
  expect(row('claude')).toMatchObject({ kind: 'chat-unavailable', reason: 'pending' })
  expect(hook.result.current.settling).toBe(true)

  act(() =>
    mocks.subscribe.mock.calls[0][3].onEvent({
      type: 'availability',
      agents: [
        { agent: 'claude', state: 'refused', reason: 'agent' },
        { agent: 'codex', state: 'available' },
        { agent: 'opencode', state: 'unknown' }
      ]
    })
  )
  expect(row('claude')).toMatchObject({ reason: 'not-on-host' })
  expect(row('codex')).toMatchObject({ kind: 'chat' })
  expect(hook.result.current.settling).toBe(false)

  // Another workspace on the same host reads the same snapshot at once, without a new stream.
  act(() => useAppStore.setState({ activeWorktreeId: 'two' }))
  hook.rerender({ id: 'two' })
  // Past the microtask a released holder closes on.
  await act(async () => {})
  expect(row('claude')).toMatchObject({ reason: 'not-on-host' })
  expect(hook.result.current.settling).toBe(false)
  expect(mocks.subscribe).toHaveBeenCalledTimes(1)
  expect(mocks.support).not.toHaveBeenCalled()
})

it('shows an older host from client facts and never asks it per agent', () => {
  mocks.publishing = false
  const hook = renderHook(() => useNewTabAgentMenuRows('one', true, { kind: 'local' }))
  expect(hook.result.current.rows.find((r) => r.agent === 'claude')).toMatchObject({
    kind: 'chat'
  })
  expect(hook.result.current.settling).toBe(false)
  expect(mocks.subscribe).not.toHaveBeenCalled()
  expect(mocks.support).not.toHaveBeenCalled()
})
