import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CRMClient } from '../client.js'

export function registerCampaignTools(server: McpServer, crm: CRMClient) {
  // 1. list-campaigns
  server.tool(
    'list-campaigns',
    'List all campaigns. Optionally filter by status.',
    { status: z.string().optional() },
    async ({ status }) => {
      try {
        const params: Record<string, string> = {}
        if (status) params.status = status
        const data = await crm.get('api-campaigns', params)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 2. get-campaign
  server.tool(
    'get-campaign',
    'Get a single campaign by ID, including enrollment counts.',
    { id: z.string() },
    async ({ id }) => {
      try {
        const data = await crm.get('api-campaigns', { id })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 3. create-campaign
  server.tool(
    'create-campaign',
    'Create a new campaign in draft status.',
    {
      name: z.string(),
      subject: z.string(),
      body: z.string(),
      scheduledAt: z.string().optional(),
      smartSend: z.boolean().optional(),
      sendSpacing: z.boolean().optional(),
      dailySendLimit: z.number().optional(),
    },
    async ({ name, subject, body, scheduledAt, smartSend, sendSpacing, dailySendLimit }) => {
      try {
        const data = await crm.post('api-campaigns', {
          name,
          subject,
          body,
          scheduled_at: scheduledAt ?? null,
          smart_send: smartSend ?? false,
          send_spacing: sendSpacing ?? null,
          daily_send_limit: dailySendLimit ?? null,
        })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 4. launch-campaign
  server.tool(
    'launch-campaign',
    'Launch a campaign. Provide scheduledAt to schedule it, otherwise activates immediately.',
    { id: z.string(), scheduledAt: z.string().optional() },
    async ({ id, scheduledAt }) => {
      try {
        const data = await crm.post(`api-campaigns?action=launch&id=${encodeURIComponent(id)}`, { scheduledAt })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 5. pause-campaign
  server.tool(
    'pause-campaign',
    'Pause an active campaign.',
    { id: z.string() },
    async ({ id }) => {
      try {
        const data = await crm.post(`api-campaigns?action=pause&id=${encodeURIComponent(id)}`, {})
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 6. resume-campaign
  server.tool(
    'resume-campaign',
    'Resume a paused campaign.',
    { id: z.string() },
    async ({ id }) => {
      try {
        const data = await crm.post(`api-campaigns?action=resume&id=${encodeURIComponent(id)}`, {})
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 7. edit-campaign-content
  server.tool(
    'edit-campaign-content',
    'Update the subject and/or body of a campaign.',
    {
      id: z.string(),
      subject: z.string().optional(),
      body: z.string().optional(),
    },
    async ({ id, subject, body }) => {
      const updates: Record<string, string> = {}
      if (subject !== undefined) updates.subject = subject
      if (body !== undefined) updates.body = body

      if (Object.keys(updates).length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No fields provided to update.' }],
        }
      }

      try {
        const data = await crm.patch('api-campaigns', { id }, updates)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 8. enroll-leads
  server.tool(
    'enroll-leads',
    'Enroll leads into a campaign by their IDs.',
    { campaignId: z.string(), leadIds: z.array(z.string()) },
    async ({ campaignId, leadIds }) => {
      try {
        const data = await crm.post(`api-campaigns?action=enroll&id=${encodeURIComponent(campaignId)}`, { leadIds })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 9. get-campaign-stats
  server.tool(
    'get-campaign-stats',
    'Get enrollment and email engagement stats for a campaign.',
    { id: z.string() },
    async ({ id }) => {
      try {
        const data = await crm.get('api-campaigns', { stats: id })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 10. create-sequence
  server.tool(
    'create-sequence',
    'Create a campaign sequence with ordered steps.',
    {
      steps: z.array(
        z.object({
          subject: z.string(),
          body: z.string(),
          delayDays: z.number(),
        })
      ),
    },
    async ({ steps }) => {
      try {
        const data = await crm.post('api-campaigns?action=sequence', {
          steps: steps.map((s) => ({ subject: s.subject, body: s.body, delayDays: s.delayDays })),
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
