import { describe, expect, it, vi } from 'vitest'
import type { ILink } from '@xterm/xterm'
import { toAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { createTerminalLinkTestDoubles } from './terminal-link-handlers-test-fixtures'
import {
  installTerminalLinkTestEnvironment,
  setPlatform
} from './terminal-link-handlers-test-harness'
import { createProviderSetup, makeBufferLine } from './terminal-link-provider-buffer-fixtures'
import { resolveTerminalLinkRuntimeEnvironmentId } from './terminal-http-link-source-owner'

const doubles = createTerminalLinkTestDoubles()
const { storeState, runtimeEnvironmentCallMock } = doubles
const bridged = vi.hoisted(() => ({ ptyIds: new Set<string>() }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => storeState } }))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: vi.fn(() => null) }))
vi.mock('./legacy-relay-bridge-panes', () => ({
  legacyRelayBridgedPane: (ptyId: string) =>
    bridged.ptyIds.has(ptyId) ? { ptyId, targetId: 'box', tabId: 't', state: 'live' } : undefined
}))
installTerminalLinkTestEnvironment(doubles)

// What the bridge transport reports while an older Orca's relay still runs the pane.
const relayPtyId = toAppSshPtyId('box', 'pty2:0360053e-409a-415b-8dee-dd911e8330ba:3')
const bridgedTransport = {
  getPtyId: () => relayPtyId,
  getRuntimeEnvironmentId: () => null,
  getConnectionId: () => null
}

function hover(runtimeEnvironmentId: string | null): Promise<ILink[]> {
  const { provider } = createProviderSetup(
    [makeBufferLine('⏺ Update(src/app/page.tsx)')],
    new Map(),
    {
      worktreePath: '/home/u/proj',
      startupCwd: '/home/u/proj',
      getRuntimeEnvironmentIdForPane: () => runtimeEnvironmentId
    }
  )
  return new Promise((resolve) => provider.provideLinks(1, (links) => resolve(links ?? [])))
}

describe('a relay-era pane in a workspace its host server now owns', () => {
  it("resolves its printed paths on the host's managed server, not this computer", async () => {
    setPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    bridged.ptyIds = new Set([relayPtyId])
    storeState.worktreesByRepo = {
      'repo-1': [{ id: 'wt-1', path: '/home/u/proj', repoId: 'repo-1', hostId: 'runtime:env-1' }]
    }
    runtimeEnvironmentCallMock.mockImplementation(
      async (args: { method: string; params: { relativePaths: string[] } }) => ({
        id: 'rpc',
        ok: true,
        result: args.params.relativePaths.map(() => ({ exists: true })),
        _meta: { runtimeId: 'remote-runtime' }
      })
    )

    const runtimeEnvironmentId = resolveTerminalLinkRuntimeEnvironmentId(
      bridgedTransport,
      () => 'env-1'
    )
    const links = await hover(runtimeEnvironmentId)

    expect(runtimeEnvironmentId).toBe('env-1')
    expect(links.map((link) => link.text)).toEqual(['src/app/page.tsx'])
    expect(window.api.shell.pathExists).not.toHaveBeenCalled()
    expect(runtimeEnvironmentCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: 'env-1',
        method: 'files.pathsExist',
        params: { worktree: 'id:wt-1', relativePaths: ['src/app/page.tsx'] }
      })
    )
  })

  it('keeps an SSH pane the bridge does not serve off the workspace server', () => {
    bridged.ptyIds = new Set()
    expect(resolveTerminalLinkRuntimeEnvironmentId(bridgedTransport, () => 'env-1')).toBeNull()
  })

  it("prefers a pane's own server", () => {
    expect(
      resolveTerminalLinkRuntimeEnvironmentId(
        { ...bridgedTransport, getRuntimeEnvironmentId: () => 'env-2' },
        () => 'env-1'
      )
    ).toBe('env-2')
  })
})
