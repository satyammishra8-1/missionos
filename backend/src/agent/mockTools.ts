import type { MissionGoal, ToolDefinition } from './types.js'

interface MockGoalInput {
  goal: string
}

export interface MockGoalOutput {
  acknowledged: true
  goal: string
}

export const mockGoalTool: ToolDefinition<MockGoalInput, MockGoalOutput> = {
  id: 'mock-goal',
  description: 'Acknowledges a goal without calling an external service.',
  inputSchema: {
    type: 'object',
    properties: { goal: { type: 'string', description: "The user's mission." } },
    required: ['goal'],
    additionalProperties: false,
  },
  supports: (goal: MissionGoal) => goal.description.trim().length > 0,
  createInput: ({ goal }) => ({ goal: goal.description }),
  parseInput: (input) => {
    if (
      typeof input !== 'object' ||
      input === null ||
      !('goal' in input) ||
      typeof input.goal !== 'string'
    ) {
      throw new Error('Mock goal tool input must contain a string goal')
    }

    return { goal: input.goal }
  },
  execute: ({ goal }) => ({ acknowledged: true, goal }),
}