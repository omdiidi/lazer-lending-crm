#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { initClient } from './client.js'
import { registerLeadTools } from './tools/leads.js'
import { registerEmailTools } from './tools/emails.js'
import { registerSendEmailTools } from './tools/send-email.js'
import { registerCampaignTools } from './tools/campaigns.js'
import { registerDealTools } from './tools/deals.js'
import { registerActivityTools } from './tools/activities.js'
import { registerApolloTools } from './tools/apollo.js'
import { registerTemplateTools } from './tools/templates.js'

async function main() {
  const crm = initClient()

  const server = new McpServer({
    name: 'connect-crm',
    version: '0.1.0',
  })

  registerLeadTools(server, crm)
  registerEmailTools(server, crm)
  registerSendEmailTools(server, crm)
  registerCampaignTools(server, crm)
  registerDealTools(server, crm)
  registerActivityTools(server, crm)
  registerApolloTools(server, crm)
  registerTemplateTools(server, crm)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('Failed to start CRM MCP server:', err)
  process.exit(1)
})
