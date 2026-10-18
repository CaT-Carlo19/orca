import { useMemo } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { getVerifiedNativeChatCommands } from '../../../../shared/native-chat-agent-profiles'
import {
  sessionReportedSkills,
  sessionSlashCommandSuggestions,
  type NativeChatSessionSkill,
  type SlashCommandSuggestion
} from '../../../../shared/native-chat-slash-commands'
import { structuredSlashCommands } from '../../../../shared/structured-agent-session-composer'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

export type NativeChatComposerCatalog = {
  agentCommands: readonly SlashCommandSuggestion[]
  sessionSkills: readonly NativeChatSessionSkill[] | undefined
}

/**
 * What the `/` menu offers. A structured session reports the surface it actually
 * loaded — the only list that includes this repo's own commands and the skills
 * that reach the session through plugin roots — so it wins whenever it is
 * present. The curated per-agent catalog remains the answer for the PTY lane and
 * for a host that predates the report.
 */
export function useNativeChatComposerCatalog(
  agent: AgentType,
  structuredTransport?: NativeChatStructuredComposerTransport
): NativeChatComposerCatalog {
  const structured = Boolean(structuredTransport)
  const reported = structuredTransport?.sessionCommands
  const conversationCommands = structuredTransport?.conversationCommands
  const agentCommands = useMemo(
    () =>
      !structured
        ? getVerifiedNativeChatCommands(agent)
        : reported !== undefined
          ? sessionSlashCommandSuggestions(agent, reported)
          : structuredSlashCommands(conversationCommands, agent),
    [agent, conversationCommands, reported, structured]
  )
  const sessionSkills = useMemo(
    () => (reported !== undefined ? sessionReportedSkills(reported) : undefined),
    [reported]
  )
  return { agentCommands, sessionSkills }
}
