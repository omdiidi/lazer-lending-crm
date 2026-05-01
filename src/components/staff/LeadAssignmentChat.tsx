import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Bot, User, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useLeads } from '@/hooks/use-leads';
import type { Lead, User as CrmUser } from '@/types/crm';
import { assignLeadsAI } from '@/lib/api/assign-leads-ai';
import type { AssignLeadsResponse, ChatMessage } from '@/lib/api/assign-leads-ai';

interface LeadAssignmentChatProps {
  leads: Lead[];
  profiles: CrmUser[];
}

export default function LeadAssignmentChat({ leads, profiles }: LeadAssignmentChatProps) {
  const { updateLeadAsync } = useLeads();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'I can help you assign leads to team members. Try: "Assign all cold SaaS leads to Sarah" or "Move unassigned tech leads to John"',
    },
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState<AssignLeadsResponse | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isThinking || isApplying) return;

    const currentMessages = [...messages];
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsThinking(true);
    setPendingAssignment(null);

    try {
      // Strip PII, cap at 500 most recent
      const leadSummaries = leads.slice(0, 500).map(l => ({
        id: l.id,
        name: `${l.firstName} ${l.lastName}`.trim(),
        company: l.company ?? '',
        status: l.status,
        industry: l.industry ?? '',
        assignedTo: profiles.find(p => p.id === l.assignedTo)?.name ?? 'Unassigned',
      }));

      const profileSummaries = profiles.map(p => ({ id: p.id, name: p.name }));

      const chatHistory = currentMessages.filter(
        (m, idx) => !(m.role === 'assistant' && idx === 0)
      );

      const result = await assignLeadsAI({
        prompt: text,
        leads: leadSummaries,
        profiles: profileSummaries,
        chatHistory,
      });

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.responseMessage,
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (result.action === 'assign' && result.matchedLeadIds.length > 0) {
        setPendingAssignment(result);
      }
    } catch (err) {
      console.error('Lead assignment AI error:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I had trouble processing that request. Please try again.',
      }]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleConfirm = async () => {
    if (!pendingAssignment) return;
    setIsApplying(true);
    try {
      for (const id of pendingAssignment.matchedLeadIds) {
        await updateLeadAsync(id, { assignedTo: pendingAssignment.targetUserId });
      }
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success(`Assigned ${pendingAssignment.matchCount} leads to ${pendingAssignment.targetUserName}`);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Done! ${pendingAssignment.matchCount} leads assigned to ${pendingAssignment.targetUserName}.`,
      }]);
      setPendingAssignment(null);
    } catch {
      toast.error('Assignment failed. Please try again.');
    } finally {
      setIsApplying(false);
    }
  };

  const handleCancel = () => {
    setPendingAssignment(null);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: 'Assignment cancelled.',
    }]);
  };

  return (
    <div className="flex flex-col h-[360px] border rounded-lg bg-muted/30">
      {/* Chat messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
              {msg.content}
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

      {/* Confirm bar */}
      {pendingAssignment && (
        <div className="border-t bg-amber-50 px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <UserCheck className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-amber-900">{pendingAssignment.confirmationMessage}</span>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={handleCancel} disabled={isApplying} className="h-7 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={isApplying} className="h-7 text-xs">
              {isApplying ? 'Assigning...' : 'Confirm'}
            </Button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t p-3 flex gap-2">
        <Input
          placeholder="e.g. Assign all cold fintech leads to Sarah..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !isThinking && !isApplying && handleSend()}
          className="h-9"
          disabled={isApplying}
        />
        <Button size="sm" onClick={handleSend} disabled={!input.trim() || isThinking || isApplying} className="gap-1.5 h-9 px-3">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
