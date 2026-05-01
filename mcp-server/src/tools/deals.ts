import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CRMClient } from '../client.js'

export function registerDealTools(server: McpServer, crm: CRMClient) {
  // 1. list-deals
  server.tool(
    'list-deals',
    'List all deals. Optionally filter by stage.',
    { stage: z.string().optional() },
    async ({ stage }) => {
      try {
        const params: Record<string, string> = {}
        if (stage) params.stage = stage
        const data = await crm.get('api-deals', params)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 2. get-deal
  server.tool(
    'get-deal',
    'Get a single deal by ID.',
    { id: z.string() },
    async ({ id }) => {
      try {
        const data = await crm.get('api-deals', { id })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 3. create-deal
  server.tool(
    'create-deal',
    'Create a new deal linked to a lead.',
    {
      leadId: z.string(),
      title: z.string(),
      value: z.number(),
      stage: z.string().optional(),
    },
    async ({ leadId, title, value, stage }) => {
      try {
        const data = await crm.post('api-deals', {
          lead_id: leadId,
          title,
          value,
          stage: stage ?? 'prospecting',
        })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 4. update-deal
  server.tool(
    'update-deal',
    "Update a deal's stage, value, or title.",
    {
      id: z.string(),
      stage: z.string().optional(),
      value: z.number().optional(),
      title: z.string().optional(),
    },
    async ({ id, stage, value, title }) => {
      const updates: Record<string, unknown> = {}
      if (stage !== undefined) updates.stage = stage
      if (value !== undefined) updates.value = value
      if (title !== undefined) updates.title = title

      if (Object.keys(updates).length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No fields provided to update.' }],
        }
      }

      try {
        const data = await crm.patch('api-deals', { id }, updates)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 5. delete-deal
  server.tool(
    'delete-deal',
    'Soft-delete a deal (sets deleted_at, recoverable).',
    { id: z.string() },
    async ({ id }) => {
      try {
        await crm.del('api-deals', { id })
        return {
          content: [{ type: 'text' as const, text: `Deal ${id} deleted.` }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )
}
