import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentMenuItems } from './CanvasMenu'
import { agentConfig, agentIds, agentName } from '@shared/agents/config'

describe('direct agent actions', () => {
  it('offers every enabled agent without a submenu or disabled custom preset', () => {
    const markup = renderToStaticMarkup(<AgentMenuItems onSelect={() => {}} />)
    for (const id of agentIds()) {
      if (agentConfig(id).enabled) expect(markup).toContain(agentName(id))
      else expect(markup).not.toContain(agentName(id))
    }
    expect(markup.match(/role="menuitem"/g)).toHaveLength(5)
    expect(markup.match(/class="agent-menu-logo"/g)).toHaveLength(4)
    expect(markup).not.toContain('context-submenu')
  })
})
