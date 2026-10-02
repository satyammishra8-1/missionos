import { Router } from 'express'
import {
  createMissionExecutionService,
  validateMissionRequest,
  type MissionExecutionService,
} from '../services/missions/MissionExecutionService.js'

export function createMissionRouter(
  service: MissionExecutionService = createMissionExecutionService(),
): Router {
  const router = Router()

  router.post('/', async (request, response) => {
    let missionRequest
    try {
      missionRequest = validateMissionRequest(request.body)
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid mission request',
      })
      return
    }

    try {
      const mission = await service.execute(missionRequest)
      response.status(200).json({
        missionId: mission.missionId,
        status: mission.status,
        error: mission.failures[0]
          ? { code: mission.failures[0].source, message: mission.failures[0].message }
          : null,
        plan: mission.planHistory.flatMap((plan) => plan.steps),
        toolCalls: mission.toolCalls,
        plannerWarnings: mission.plannerWarnings,
        replans: mission.replans,
        findings: mission.completedTasks,
        evidence: mission.evidence,
        result: {
          summary: mission.finalResult ?? null,
          verifiedFacts: mission.verifiedFacts,
          assumptions: mission.assumptions,
          missingInformation: mission.missingInformation,
          constraints: mission.constraintAssessments,
        },
      })
    } catch {
      response.status(500).json({ error: 'Mission execution failed' })
    }
  })

  return router
}