import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CRMClient } from '../client.js'

export function registerEmailTools(server: McpServer, crm: CRMClient): void {
  // 1. list-emails
  server.tool(
    'list-emails',
    'List emails by folder (inbox/sent/all). Admins see all; employees see only their own.',
    {
      folder: z
        .enum(['inbox', 'sent', 'all'])
        .optional()
        .describe('inbox = inbound, sent = outbound, all = both'),
      limit: z.number().int().positive().default(50).describe('Max results'),
    },
    async ({ folder, limit }) => {
      try {
        const params: Record<string, string> = {}
        if (folder) params.folder = folder
        if (limit) params.limit = String(limit)
        const data = await crm.get('api-emails', params)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data ?? [], null, 2) }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
      }
    }
  )

  // 2. get-email
  server.tool(
    'get-email',
    'Get a single email by ID.',
    {
      id: z.string().describe('Email ID'),
    },
    async ({ id }) => {
      try {
        const data = await crm.get('api-emails', { id })
        if (!data) {
          return { content: [{ type: 'text' as const, text: 'Email not found' }] }
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
      }
    }
  )

  // 3. get-thread
  server.tool(
    'get-thread',
    'Get all emails in a thread, ordered oldest to newest.',
    {
      threadId: z.string().describe('Thread ID'),
    },
    async ({ threadId }) => {
      try {
        const data = await crm.get('api-emails', { threadId })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data ?? [], null, 2) }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
      }
    }
  )

  // 4. mark-email-read
  server.tool(
    'mark-email-read',
    'Mark an email as read or unread.',
    {
      id: z.string().describe('Email ID'),
      read: z.boolean().default(true).describe('True to mark read, false to mark unread'),
    },
    async ({ id, read }) => {
      try {
        await crm.patch('api-emails', { id }, { read })
        return {
          content: [{ type: 'text' as const, text: `Email ${id} marked as ${read ? 'read' : 'unread'}` }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
      }
    }
  )

  // 5. delete-email
  server.tool(
    'delete-email',
    'Soft-delete an email by setting deleted_at.',
    {
      id: z.string().describe('Email ID'),
    },
    async ({ id }) => {
      try {
        await crm.del('api-emails', { id })
        return {
          content: [{ type: 'text' as const, text: `Email ${id} deleted` }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
      }
    }
  )

  // 6. list-threads
  server.tool(
    'list-threads',
    'List email threads, returning the most recent email per thread.',
    {
      limit: z.number().int().positive().default(30).describe('Max threads to return'),
    },
    async ({ limit }) => {
      try {
        const params: Record<string, string> = { threads: '1' }
        if (limit) params.limit = String(limit)
        const data = await crm.get('api-emails', params)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data ?? [], null, 2) }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
      }
    }
  )
}
