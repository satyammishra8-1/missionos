import cors from 'cors'
import express from 'express'
import { environment } from './config/environment.js'
import { healthRouter } from './routes/health.js'
import { createMissionRouter } from './routes/missions.js'

export const app = express()

app.use(cors({ origin: environment.frontendOrigin }))
app.use(express.json())
app.use('/api/health', healthRouter)
app.use('/api/missions', createMissionRouter())