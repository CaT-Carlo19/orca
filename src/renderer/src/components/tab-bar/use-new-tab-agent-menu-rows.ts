import { useEffect, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  STRUCTURED_AGENT_SESSION_AVAILABILITY_RUNTIME_CAPABILITY as AVAILABILITY,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY as CATALOG
} from '../../../../shared/protocol-version'
import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../../../shared/execution-host'
import { lastVerifiedRuntimeStatus } from '../../../../shared/runtime-host-status'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { isNativeChatEnabled } from '../../../../shared/structured-native-chat-launch-route'
import { useAppStore } from '@/store'
import {
  structuredAgentLaunchSupport,
  type AgentLaunchRoutingInput
} from '@/lib/agent-launch-routing'
import {
  buildAgentLaunchRouteInput,
  workspaceKindForWorktreeId
} from '@/lib/agent-launch-route-input'
import { chatProviderAgents, useHostStructuredAgentsVersion } from '@/lib/chat-provider-agents'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import {
  readHostStructuredAgents,
  relearnHostStructuredAgents
} from '@/runtime/host-structured-agents'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { useHostStructuredAgentAvailability } from '@/runtime/use-host-structured-agent-availability'
import { buildNewTabAgentMenuRows, type HostChatAnswer } from '@/lib/new-tab-agent-menu-rows'
import {
  readLocalRuntimeCapabilitiesOrUnknown,
  subscribeLocalRuntimeCapabilitiesKnown
} from '@/runtime/local-runtime-capabilities'
import { useDetectedAgents, type AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { readDetectedAgentsForTarget } from '@/lib/agent-detection-target-inventory'

function hostChatAnswer(input: AgentLaunchRoutingInput): HostChatAnswer {
  const support = structuredAgentLaunchSupport(input)
  if (support.supported) {
    return 'yes'
  }
  switch (support.blocker) {
    case 'runtime-capability-unknown':
      return 'not-yet-known'
    case 'agent-without-structured-session':
      return !input.hostStructuredAgents && input.hostCapabilities?.includes(CATALOG) !== false
        ? 'not-yet-known'
        : 'not-on-host'
    case 'remote-execution-host':
      return 'ssh'
    case 'project-runtime':
      return 'wsl'
    case 'runtime-capability':
    case 'client-capability':
      return 'no-chats'
    case 'custom-start-directory':
    case 'reused-terminal':
      return 'yes'
  }
}

export type NewTabAgentMenuModel = ReturnType<typeof useNewTabAgentMenuRows>

/** `detectionTarget` is the workspace's agent-inventory host, resolved by the caller. */
export function useNewTabAgentMenuRows(
  worktreeId: string,
  open: boolean,
  detectionTarget: AgentDetectionTarget | undefined
) {
  // Why: hidden worktrees stay mounted, so only the shown one holds its host's streams.
  const worktreeShown = useAppStore((state) => state.activeWorktreeId === worktreeId)
  // Why: acquiring while the workspace is shown means the first open already knows its agents.
  const acquired = useDetectedAgents(open || worktreeShown ? detectionTarget : undefined)
  // Closing the menu or leaving the workspace must not erase the known inventory.
  const storedIds = useAppStore((state) =>
    detectionTarget ? readDetectedAgentsForTarget(state, detectionTarget) : null
  )
  const detection = { ...acquired, detectedIds: acquired.detectedIds ?? storedIds }
  useHostStructuredAgentsVersion()
  useSyncExternalStore(
    subscribeLocalRuntimeCapabilitiesKnown,
    readLocalRuntimeCapabilitiesOrUnknown,
    readLocalRuntimeCapabilitiesOrUnknown
  )
  const settings = useAppStore((state) => state.settings)
  const workspace = { kind: workspaceKindForWorktreeId(worktreeId), worktreeId }
  const facts = useAppStore(
    useShallow((state) => {
      const input = buildAgentLaunchRouteInput(state, { agent: 'claude', workspace })
      const host = parseExecutionHostId(input.executionHostId)
      const status =
        host?.kind === 'runtime'
          ? state.runtimeStatusByEnvironmentId.get(host.environmentId)
          : undefined
      return {
        executionHostId: input.executionHostId,
        runtimeId: host?.kind === 'runtime' ? lastVerifiedRuntimeStatus(status)?.runtimeId : null,
        pairingRevision:
          host?.kind === 'runtime' ? getRuntimeEnvironmentRevision(host.environmentId) : undefined,
        contact: `${status?.connectionGeneration}:${status?.hostContactEpoch}`,
        capabilities: input.hostCapabilities?.join(',')
      }
    })
  )
  const state = useAppStore.getState()
  const inputFor = (agent: TuiAgent) => buildAgentLaunchRouteInput(state, { agent, workspace })
  const input = inputFor('claude')
  const catalogLoaded =
    Boolean(readHostStructuredAgents(input.executionHostId, state.runtimeStatusByEnvironmentId)) ||
    input.hostCapabilities?.includes(CATALOG) === false
  const chatAgents = [
    ...new Set([
      ...chatProviderAgents(LOCAL_EXECUTION_HOST_ID, state.runtimeStatusByEnvironmentId),
      ...chatProviderAgents(input.executionHostId, state.runtimeStatusByEnvironmentId),
      ...Object.keys(settings?.nativeChatProviders ?? {})
        .filter(isTuiAgent)
        .filter((agent) => settings?.nativeChatProviders?.[agent] === true)
    ])
  ]
  const chatEnabled = isNativeChatEnabled(settings)
  // Why a branch: a host publishing availability answers every agent from its one health snapshot;
  // an older host shows this client's facts, and the click's admission states the host's refusal.
  const published =
    input.hostCapabilities?.includes(AVAILABILITY) === true &&
    Boolean(structuredAgentSessionTargetForHost(facts.executionHostId))
  const availability = useHostStructuredAgentAvailability(
    published && chatEnabled
      ? {
          executionHostId: facts.executionHostId,
          runtimeId: facts.runtimeId,
          pairingRevision: facts.pairingRevision,
          contact: facts.contact,
          hold: worktreeShown || open
        }
      : null
  )
  useEffect(() => {
    if (!open || !chatEnabled) {
      return
    }
    const state = useAppStore.getState()
    if (!catalogLoaded) {
      const input = buildAgentLaunchRouteInput(state, {
        agent: 'claude',
        workspace: { kind: workspaceKindForWorktreeId(worktreeId), worktreeId }
      })
      void relearnHostStructuredAgents(
        input.executionHostId,
        input.hostCapabilities,
        state.runtimeStatusByEnvironmentId
      )
    }
  }, [open, chatEnabled, facts, worktreeId, catalogLoaded])
  // Only reads that settle on their own count: detection finishes or fails, and a stream that fails
  // before its first snapshot is ready.
  let waiting =
    detection.detectedIds === null &&
    !detection.detectionFailed &&
    !detection.needsServerUpdate &&
    detectionTarget !== undefined
  const rows = buildNewTabAgentMenuRows({
    settings,
    detectedOnHost: detection.detectedIds,
    chatAgents,
    catalogLoaded,
    hostChatAnswer: (agent) => {
      const preliminary = hostChatAnswer(inputFor(agent))
      if (!availability || !['yes', 'not-yet-known'].includes(preliminary)) {
        return preliminary
      }
      // One snapshot answers every row; until the first lands, the menu holds a placeholder.
      if (!availability.ready) {
        waiting = true
        return 'not-yet-known'
      }
      const verdict = availability.byAgent.get(agent)?.state
      // An agent the host could not check keeps this client's facts; the click's admission decides.
      return verdict === 'available' ? 'yes' : verdict === 'refused' ? 'not-on-host' : preliminary
    }
  }).map((row) => ({ ...row, executionHostId: parseExecutionHostId(facts.executionHostId)?.id }))
  return { rows, detection, settling: waiting }
}
