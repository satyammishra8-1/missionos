import { AgentState } from './AgentState.js'

export class Replanner {
  replan(state: AgentState, reason: string, failedToolId?: string): AgentState {
    if (state.status === 'planning' || state.status === 'replanning') {
      return state.requestReplan(reason)
    }
    return state.beginReplan(reason, failedToolId)
  }
}