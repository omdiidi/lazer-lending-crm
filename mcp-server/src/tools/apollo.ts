import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CRMClient } from '../client.js'

export function registerApolloTools(server: McpServer, crm: CRMClient) {
  // 1. search-apollo
  server.tool(
    'search-apollo',
    'Search Apollo for people matching your criteria. WARNING: Uses Apollo credits (1 per enriched contact). Use sparingly.',
    {
      prompt: z.string(),
      perPage: z.number().default(10),
    },
    async ({ prompt, perPage }) => {
      try {
        const result = await crm.post('apollo-search', { prompt, perPage: perPage ?? 10 })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // 2. search-apollo-companies
  server.tool(
    'search-apollo-companies',
    'Search Apollo for companies. WARNING: Uses Apollo credits.',
    {
      prompt: z.string(),
      perPage: z.number().default(10),
    },
    async ({ prompt, perPage }) => {
      try {
        const companyPrompt = `companies: ${prompt}`
        const result = await crm.post('apollo-search', { prompt: companyPrompt, perPage: perPage ?? 10 })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )
}
