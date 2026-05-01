import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CRMClient } from '../client.js'

export function registerSendEmailTools(server: McpServer, crm: CRMClient): void {
  // 1. compose-email
  server.tool(
    'compose-email',
    'Compose and send a new email via Resend, then record it in the database.',
    {
      to: z.string().email().describe('Recipient email address'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body (plain text or HTML)'),
      leadId: z.string().optional().describe('Associate this email with a lead ID'),
    },
    async ({ to, subject, body, leadId }) => {
      try {
        await crm.post('send-email', {
          emails: [{ to, subject, body, leadId: leadId ?? null }],
        }) as { emails: unknown[]; count: number }
        return {
          content: [{ type: 'text' as const, text: 'Email sent successfully.' }],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to send email: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        }
      }
    }
  )

  // 2. reply-to-email
  server.tool(
    'reply-to-email',
    'Reply to an existing email thread via Resend, with proper threading headers.',
    {
      threadId: z.string().describe('Thread ID to reply within'),
      replyToId: z.string().describe('ID of the specific email being replied to'),
      to: z.string().email().describe('Recipient email address'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Reply body (plain text or HTML)'),
      leadId: z.string().optional().describe('Associate this reply with a lead ID'),
    },
    async ({ threadId, replyToId, to, subject, body, leadId }) => {
      try {
        await crm.post('send-email', {
          emails: [{ to, subject, body, threadId, replyToId, leadId: leadId ?? null }],
        }) as { emails: unknown[]; count: number }
        return {
          content: [{ type: 'text' as const, text: 'Reply sent successfully.' }],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to send reply: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        }
      }
    }
  )
}
