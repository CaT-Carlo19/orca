import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentTypeIcon, programLetter } from './agent-type-icon'

function render(agentType: string | null | undefined): string {
  return renderToStaticMarkup(<AgentTypeIcon agentType={agentType} />)
}

describe('AgentTypeIcon', () => {
  it("renders a program's first letter", () => {
    expect(render('brew')).toContain('>B</text>')
    expect(render('terraform')).toContain('>T</text>')
  })

  it('keeps "?" for unidentified agents', () => {
    expect(render('unknown')).toContain('>?</text>')
    expect(render(null)).toContain('>?</text>')
    expect(render(undefined)).toContain('>?</text>')
  })

  it('still renders the Claude icon for known agents', () => {
    expect(render('claude')).toContain('#D97757')
  })
})

describe('programLetter', () => {
  it('skips leading punctuation the app id grammar allows', () => {
    expect(programLetter('_9tool')).toBe('9')
    expect(programLetter('.+-')).toBe('?')
  })
})
