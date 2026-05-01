import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CRMClient } from '../client.js'

export function registerActivityTools(server: McpServer, crm: CRMClient) {
  // 1. get-lead-timeline
  server.tool(
    'get-lead-timeline',
    'Get the full activity and email timeline for a lead, sorted by most recent first.',
    { leadId: z.string() },
    async ({ leadId }) => {
      try {
        const data = await crm.get('api-activities', { leadId })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 2. create-activity
  server.tool(
    'create-activity',
    'Log an activity (call, note, meeting, etc.) against a lead.',
    {
      leadId: z.string(),
      type: z.enum(['call', 'email_sent', 'email_received', 'note', 'status_change', 'meeting']),
      description: z.string(),
      metadata: z.record(z.string()).optional(),
    },
    async ({ leadId, type, description, metadata }) => {
      try {
        const data = await crm.post('api-activities', {
          lead_id: leadId,
          type,
          description,
          metadata: metadata ?? null,
        })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )
}
