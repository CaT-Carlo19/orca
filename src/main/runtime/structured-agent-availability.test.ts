import { homedir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import type { GlobalSettings } from '../../shared/global-settings-types'

const mocks = vi.hoisted(() => ({
  refreshed: new Set<() => void>(),
  observe: vi.fn(),
  recapture: vi.fn(async () => {})
}))
vi.mock('../preflight/workspace-agent-detection', () => ({
  onAgentsRefreshedOnHost: (listener: () => void) => mocks.refreshed.add(listener)
}))
vi.mock('./structured-agent-launch-support', () => ({
  observeStructuredAgentLaunch: mocks.observe
}))
vi.mock('./structured-agent-shell-environment', () => ({
  recaptureHostShellEnvironment: mocks.recapture
}))
// Grok stands for an agent this host cannot supervise (Windows without process start times).
vi.mock('./structured-agent-runtime-metadata', () => ({
  STRUCTURED_AGENT_RUNTIME_METADATA: ['claude', 'grok', 'pi', 'opencode'].map((agent) => ({
    definition: { agent },
    supportsLocation: () => agent !== 'grok'
  }))
}))

import { installStructuredAgentAvailability } from './structured-agent-availability'

function install() {
  const listeners: ((updates: Partial<GlobalSettings>, settings: GlobalSettings) => void)[] = []
  const store = {
    onSettingsChanged: (listener: (typeof listeners)[number]) => {
      listeners.push(listener)
      return () => {}
    }
  }
  const availability = installStructuredAgentAvailability(store, {
    requireStore: () => ({ getSettings: () => getDefaultSettings('/home/test') })
  })
  const change = (updates: Partial<GlobalSettings>): void =>
    listeners.forEach((listener) => listener(updates, getDefaultSettings('/home/test')))
  return { availability, change }
}

it('probes the host once in its own home and shares the snapshot with every reader', async () => {
  const cwds: string[] = []
  mocks.observe.mockImplementation(async (agent: string, cwd: () => Promise<string>) => {
    cwds.push(await cwd())
    if (agent === 'pi') {
      throw new Error('Command setting not runnable')
    }
    return agent === 'opencode' ? 'unsupported' : 'supported'
  })
  const { availability } = install()
  const first = vi.fn()
  const release = availability.subscribe(first)
  await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1))
  release()
  expect(first.mock.calls[0][0]).toEqual([
    { agent: 'claude', state: 'available' },
    { agent: 'grok', state: 'refused', reason: 'agent' },
    // A check that could not answer is no verdict.
    { agent: 'pi', state: 'unknown' },
    { agent: 'opencode', state: 'refused', reason: 'agent' }
  ])
  expect(cwds).toEqual([homedir(), homedir(), homedir()])
  // Kept with no readers: a later one reads it at once, without probing again.
  const later = vi.fn()
  availability.subscribe(later)
  expect(later).toHaveBeenCalledWith(first.mock.calls[0][0])
  expect(mocks.observe).toHaveBeenCalledTimes(3)
})

it('replaces the snapshot on a launch setting or Refresh, which first recaptures the shell', async () => {
  mocks.observe.mockReset().mockResolvedValue('supported')
  mocks.refreshed.clear()
  const { availability, change } = install()
  const read = vi.fn()
  availability.subscribe(read)
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  change({ terminalFontSize: 14 })
  change({ agentCmdOverrides: { pi: '/opt/pi' } })
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  expect(mocks.recapture).not.toHaveBeenCalled()

  const capture = Promise.withResolvers<void>()
  mocks.recapture.mockReturnValueOnce(capture.promise)
  mocks.refreshed.forEach((listener) => listener())
  await Promise.resolve()
  expect(mocks.observe).toHaveBeenCalledTimes(6)
  capture.resolve()
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3))
  expect(mocks.observe).toHaveBeenCalledTimes(9)
})
