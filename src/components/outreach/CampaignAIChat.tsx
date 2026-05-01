import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Bot, User } from 'lucide-react';
import type { Lead } from '@/types/crm';
import { generateCampaignCopy } from '@/lib/api/campaign-ai';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface CampaignAIChatProps {
  leads: Lead[];
  industries: string[];
  onApplyResult: (result: {
    matchedLeadIds: string[];
    subject: string;
    body: string;
    statusFilter?: string;
    industryFilter?: string;
  }) => void;
}

export default function CampaignAIChat({ leads, industries, onApplyResult }: CampaignAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Describe your campaign and I\'ll auto-select recipients and draft the email. For example: "Send a cold outreach email to all SaaS leads about our integration platform"',
    },
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    // Snapshot messages BEFORE adding user message to avoid chat history duplication
    const currentMessages = [...messages];

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsThinking(true);

    try {
      // Prepare lead summaries — strip sensitive fields (no emails, phones)
      const leadSummaries = leads.map(l => ({
        id: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        company: l.company,
        industry: l.industry,
        status: l.status,
        jobTitle: l.jobTitle,
        location: l.location,
      }));

      // Build chat history from snapshot (exclude welcome message)
      const chatHistory = currentMessages
        .filter(m => m.id !== 'welcome')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const result = await generateCampaignCopy({
        prompt: text,
        leads: leadSummaries,
        industries,
        chatHistory,
      });

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.explanation,
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Map to onApplyResult format:
      // - Empty matchedLeadIds [] means "all leads" → pass all lead IDs
      // - Empty string statusFilter/industryFilter → undefined
      onApplyResult({
        matchedLeadIds: result.matchedLeadIds.length > 0
          ? result.matchedLeadIds
          : leads.map(l => l.id),
        subject: result.subject,
        body: result.body,
        statusFilter: result.statusFilter || undefined,
        industryFilter: result.industryFilter || undefined,
      });
    } catch (err) {
      console.error('Campaign AI error:', err);
      const errorMsg: ChatMessage = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I had trouble generating that campaign. Please try again.',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-[360px] border rounded-lg bg-muted/30">
      {/* Chat messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background border text-foreground'
              }`}
            >
              {msg.content.split('**').map((part, i) =>
                i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {isThinking && (
          <div className="flex gap-2.5">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="bg-background border rounded-lg px-3.5 py-2.5 text-sm text-muted-foreground">
              Thinking<span className="animate-pulse">...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-3 flex gap-2">
        <Input
          placeholder="Describe your campaign..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !isThinking && handleSend()}
          className="h-9"
        />
        <Button size="sm" onClick={handleSend} disabled={!input.trim() || isThinking} className="gap-1.5 h-9 px-3">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
