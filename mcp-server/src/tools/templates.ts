import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CRMClient } from '../client.js'

export function registerTemplateTools(server: McpServer, crm: CRMClient) {
  // 1. list-templates
  server.tool(
    'list-templates',
    'List all campaign templates.',
    {},
    async () => {
      try {
        const data = await crm.get('api-templates')
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 2. create-template
  server.tool(
    'create-template',
    'Create a new campaign template.',
    {
      name: z.string(),
      subject: z.string(),
      body: z.string(),
      tags: z.array(z.string()).optional(),
    },
    async ({ name, subject, body, tags }) => {
      try {
        const data = await crm.post('api-templates', { name, subject, body, tags: tags ?? [] })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 3. delete-template
  server.tool(
    'delete-template',
    'Soft-delete a campaign template (sets deleted_at, recoverable).',
    { id: z.string() },
    async ({ id }) => {
      try {
        await crm.del('api-templates', { id })
        return {
          content: [{ type: 'text' as const, text: `Template ${id} deleted.` }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )
}
