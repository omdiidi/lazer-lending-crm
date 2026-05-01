import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads } from '@/hooks/use-leads';
import { useEmails } from '@/hooks/use-emails';
import { useActivities } from '@/hooks/use-activities';
import { useProfiles } from '@/hooks/use-profiles';
import { useSequences } from '@/hooks/use-sequences';
import { useQueryClient } from '@tanstack/react-query';
import { sendEmail } from '@/lib/api/send-email';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, RefreshCw, Inbox, PenLine, Layers, Clock, Mail, Megaphone, ArrowLeft, Reply, Forward, ArrowUpRight, Eye, MousePointerClick, AlertTriangle, Bold, Italic, Link2, List, Plus, Paperclip, Download } from 'lucide-react';
import { uploadAttachment, getSignedUrl } from '@/lib/api/email-attachments';
import { useEmailAttachments } from '@/hooks/use-email-attachments';
import type { EmailMessage } from '@/types/crm';
import CampaignList from '@/components/campaigns/CampaignList';
import { EmailBody } from '@/components/email/EmailBody';


interface EmailThread {
  id: string;
  subject: string;
  messages: EmailMessage[];
  latestAt: string;
  unreadCount: number;
  participants: string[];
  leadId?: string;
}

function MessageAttachments({ emailId }: { emailId: string }) {
  const { data: attachments = [] } = useEmailAttachments(emailId);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!attachments.length) return;
    Promise.all(
      attachments.map(att =>
        getSignedUrl(att.storagePath)
          .then(url => ({ id: att.id, url }))
          .catch(() => ({ id: att.id, url: '' }))
      )
    ).then(results => {
      const map: Record<string, string> = {};
      results.forEach(r => { if (r.url) map[r.id] = r.url; });
      setSignedUrls(map);
    });
  }, [attachments]);

  if (!attachments.length) return null;

  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <p className="text-xs text-muted-foreground font-medium">
        {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {attachments.map(att => {
          const url = signedUrls[att.id];
          const isImage = att.contentType.startsWith('image/');
          return (
            <div key={att.id} className="border rounded-md overflow-hidden">
              {isImage && url ? (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={url}
                    alt={att.filename}
                    className="max-h-[200px] max-w-[300px] object-contain block"
                  />
                </a>
              ) : url ? (
                <a
                  href={url}
                  download={att.filename}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors"
                >
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="max-w-[180px] truncate">{att.filename}</span>
                  <span className="text-muted-foreground">({(att.fileSize / 1024).toFixed(0)}KB)</span>
                  <Download className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OutreachPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAdmin } = useAuth();
  const [tab, setTab] = useState('inbox');
  const showAll = isAdmin && tab === 'all-emails';
  const { emails, addEmail, addEmailAsync, markEmailRead, isLoading: emailsLoading, isFetching } = useEmails(showAll ? undefined : user?.id);
  const { leads } = useLeads();
  const emailSafeLeads = useMemo(() =>
    leads.filter(l =>
      l.emailStatus === 'verified' || l.emailStatus === 'likely_to_engage'
    ),
    [leads]
  );
  const { addActivity } = useActivities();
  const { profiles } = useProfiles();
  const { sequences } = useSequences();
  const queryClient = useQueryClient();

  // Inbox state
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'forward' | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [inboxSearch, setInboxSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [inboxFolder, setInboxFolder] = useState<'inbox' | 'sent' | 'all'>('inbox');

  // Compose state
  const [toSearch, setToSearch] = useState('');
  const [toLeadId, setToLeadId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [composeAttachments, setComposeAttachments] = useState<Array<{
    storagePath: string; filename: string; contentType: string; size: number;
  }>>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);


  useEffect(() => {
    const threadParam = searchParams.get('thread')
    if (threadParam) {
      setSelectedThreadId(threadParam)
      setTab('inbox')
    }
  }, [searchParams])

  // Build threads from emails
  const threads = useMemo<EmailThread[]>(() => {
    const threadMap = new Map<string, EmailMessage[]>();
    emails.forEach(email => {
      const tid = email.threadId || email.id;
      if (!threadMap.has(tid)) threadMap.set(tid, []);
      threadMap.get(tid)!.push(email);
    });
    const result: EmailThread[] = [];
    threadMap.forEach((msgs, tid) => {
      const sorted = [...msgs].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
      const latest = sorted[sorted.length - 1];
      const participants = [...new Set(sorted.flatMap(m => [m.from, m.to]))];
      result.push({
        id: tid,
        subject: sorted[0].subject.replace(/^(Re: |Fwd: )+/i, ''),
        messages: sorted,
        latestAt: latest.sentAt,
        unreadCount: sorted.filter(m => !m.read).length,
        participants,
        leadId: sorted.find(m => m.leadId)?.leadId,
      });
    });
    return result.sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
  }, [emails]);

  const folderThreads = useMemo(() => {
    switch (inboxFolder) {
      case 'inbox':
        return threads.filter(t => t.messages.some(m => m.direction === 'inbound'));
      case 'sent':
        return threads.filter(t => t.messages.some(m => m.direction === 'outbound'));
      case 'all':
      default:
        return threads;
    }
  }, [threads, inboxFolder]);

  const filteredThreads = useMemo(() => {
    if (!inboxSearch) return folderThreads;
    const q = inboxSearch.toLowerCase();
    return folderThreads.filter(t =>
      t.subject.toLowerCase().includes(q) ||
      t.participants.some(p => p.toLowerCase().includes(q)) ||
      t.messages.some(m => m.body.toLowerCase().includes(q))
    );
  }, [folderThreads, inboxSearch]);

  const selectedThread = threads.find(t => t.id === selectedThreadId) ?? null;

  // Compose lead search
  const filteredComposeLeads = useMemo(() => {
    if (!toSearch) return emailSafeLeads.slice(0, 10);
    const q = toSearch.toLowerCase();
    return emailSafeLeads.filter(l =>
      l.firstName.toLowerCase().includes(q) ||
      l.lastName.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      l.company.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [emailSafeLeads, toSearch]);

  const handleSelectThread = (thread: EmailThread) => {
    setSelectedThreadId(thread.id);
    setReplyMode(null);
    setReplyBody('');
    // Mark all unread messages as read
    thread.messages.filter(m => !m.read).forEach(m => markEmailRead(m.id));
  };

  const handleSendReply = async () => {
    if (!selectedThread || !replyBody.trim()) return;
    if (!user?.emailPrefix) {
      toast.error('Set your sending email in Settings before sending');
      return;
    }
    const lastMsg = selectedThread.messages[selectedThread.messages.length - 1];
    const isForward = replyMode === 'forward';
    const toAddress = isForward ? '' : (lastMsg.direction === 'inbound' ? lastMsg.from : lastMsg.to);

    if (!toAddress) {
      toast.error('Forward requires a recipient address');
      return;
    }

    const newSubject = isForward
      ? `Fwd: ${selectedThread.subject}`
      : `Re: ${selectedThread.subject}`;

    try {
      await sendEmail({
        leadId: selectedThread.leadId,
        from: `${user.emailPrefix}@integrateapi.ai`,
        fromName: user.name,
        to: toAddress,
        subject: newSubject,
        body: replyBody.trim(),
        threadId: selectedThread.id,
        replyToId: lastMsg.id,
      });
      if (selectedThread.leadId) {
        addActivity({
          leadId: selectedThread.leadId,
          userId: user.id,
          type: 'email_sent',
          description: `Replied to thread: "${selectedThread.subject}"`,
          timestamp: new Date().toISOString(),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      setReplyMode(null);
      setReplyBody('');
      toast.success('Reply sent');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send reply');
    }
  };

  const handleSendEmail = async () => {
    const recipientEmail = toLeadId
      ? leads.find(l => l.id === toLeadId)?.email
      : toEmail;
    if (!recipientEmail || !subject.trim() || !body.trim()) return;
    if (!user?.emailPrefix) {
      toast.error('Set your sending email in Settings before sending');
      return;
    }

    try {
      await sendEmail({
        leadId: toLeadId || undefined,
        from: `${user.emailPrefix}@integrateapi.ai`,
        fromName: user.name,
        to: recipientEmail,
        subject: subject.trim(),
        body: body.trim(),
        threadId: `t-${Date.now()}`,
        attachments: composeAttachments.length > 0 ? composeAttachments : undefined,
      });
      if (toLeadId) {
        addActivity({
          leadId: toLeadId,
          userId: user.id,
          type: 'email_sent',
          description: `Sent email: "${subject.trim()}"`,
          timestamp: new Date().toISOString(),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      setToSearch('');
      setToLeadId('');
      setToEmail('');
      setSubject('');
      setBody('');
      setComposeAttachments([]);
      toast.success('Email sent');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send email');
    }
  };

  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setAttachmentUploading(true);
    try {
      let runningTotal = composeAttachments.reduce((s, a) => s + a.size, 0);
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`${file.name} exceeds 10MB limit`);
          continue;
        }
        if (runningTotal + file.size > MAX_TOTAL_BYTES) {
          toast.error('Total attachment size would exceed 25MB');
          break;
        }
        try {
          const result = await uploadAttachment(file);
          setComposeAttachments(prev => [...prev, result]);
          runningTotal += file.size;
        } catch {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
    } finally {
      setAttachmentUploading(false);
    }
    e.target.value = '';
  };

  const handleRefresh = () => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ['emails'] }).then(() => setRefreshing(false));
  };

  const getContactName = (email: string) => {
    const lead = leads.find(l => l.email === email);
    if (lead) return `${lead.firstName} ${lead.lastName}`;
    const usr = profiles.find(u => u.email === email);
    if (usr) return usr.name;
    return email.split('@')[0];
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 1) return `${Math.max(1, Math.round(diffMs / 60000))}m ago`;
    if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`;
    if (diffHrs < 48) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isOwnEmail = (email: string) => profiles.some(u => u.email === email);

  return (
    <div className="p-6 max-w-[1200px] space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Outreach</h1>
        <p className="text-sm text-muted-foreground">Email, campaigns, and sequences management</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v !== 'inbox' && v !== 'all-emails') setSelectedThreadId(null); }}>
        <TabsList>
          <TabsTrigger value="inbox" className="gap-1.5"><Inbox className="h-3.5 w-3.5" />Inbox</TabsTrigger>
          <TabsTrigger value="compose" className="gap-1.5"><PenLine className="h-3.5 w-3.5" />Compose</TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-1.5"><Megaphone className="h-3.5 w-3.5" />Campaigns</TabsTrigger>
          <TabsTrigger value="sequences" className="gap-1.5"><Layers className="h-3.5 w-3.5" />Sequences</TabsTrigger>
          {isAdmin && <TabsTrigger value="all-emails" className="gap-1.5"><Mail className="h-3.5 w-3.5" />All Emails</TabsTrigger>}
        </TabsList>

        {/* ===== INBOX ===== */}
        <TabsContent value="inbox" className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Input
                placeholder="Search emails..."
                value={inboxSearch}
                onChange={e => setInboxSearch(e.target.value)}
                className="w-[260px] h-9"
              />
              <p className="text-sm text-muted-foreground">{filteredThreads.length} conversations</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          <div className="flex border rounded-lg bg-background overflow-hidden" style={{ height: 'calc(100vh - 240px)', minHeight: '500px' }}>
            {/* Folder sidebar */}
            <div className="hidden md:flex flex-col border-r w-[52px] min-w-[52px] py-2 gap-1 items-center">
              <button
                onClick={() => { setInboxFolder('inbox'); setSelectedThreadId(null); }}
                className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-[10px] w-full transition-colors ${
                  inboxFolder === 'inbox' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'
                }`}
                title="Inbox"
              >
                <Inbox className="h-4 w-4" />
                <span>Inbox</span>
              </button>
              <button
                onClick={() => { setInboxFolder('sent'); setSelectedThreadId(null); }}
                className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-[10px] w-full transition-colors ${
                  inboxFolder === 'sent' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'
                }`}
                title="Sent"
              >
                <ArrowUpRight className="h-4 w-4" />
                <span>Sent</span>
              </button>
              <button
                onClick={() => { setInboxFolder('all'); setSelectedThreadId(null); }}
                className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-[10px] w-full transition-colors ${
                  inboxFolder === 'all' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'
                }`}
                title="All Mail"
              >
                <Layers className="h-4 w-4" />
                <span>All</span>
              </button>
            </div>
            {/* Thread list */}
            <div className={`${selectedThread ? 'hidden md:flex' : 'flex'} flex-col border-r w-full md:w-[360px] md:min-w-[360px]`}>
              <ScrollArea className="flex-1">
                {filteredThreads.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                    No conversations found
                  </div>
                ) : (
                  filteredThreads.map(thread => {
                    const isSelected = selectedThreadId === thread.id;
                    const latestMsg = thread.messages[thread.messages.length - 1];
                    const otherParticipant = thread.participants.find(p => !isOwnEmail(p)) || thread.participants[0];

                    return (
                      <div
                        key={thread.id}
                        onClick={() => handleSelectThread(thread)}
                        className={`px-4 py-3 border-b cursor-pointer transition-colors hover:bg-accent/50 ${
                          isSelected ? 'bg-accent' : ''
                        } ${thread.unreadCount > 0 ? '' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            {thread.unreadCount > 0 ? (
                              <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                            ) : (
                              <div className="h-2.5 w-2.5" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-sm truncate ${thread.unreadCount > 0 ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                                {getContactName(otherParticipant)}
                              </p>
                              <span className="text-[11px] text-muted-foreground flex-shrink-0">{formatTime(thread.latestAt)}</span>
                            </div>
                            <p className={`text-sm truncate mt-0.5 ${thread.unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                              {thread.subject}
                            </p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {latestMsg.direction === 'outbound' ? 'You: ' : ''}{latestMsg.body.split('\n')[0].slice(0, 80)}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {thread.messages.length > 1 && (
                                <span className="text-[11px] text-muted-foreground">{thread.messages.length} messages</span>
                              )}
                              {thread.messages.some(m => m.direction === 'outbound' && m.openedAt) && (
                                <Eye className="h-3 w-3 text-emerald-500 flex-shrink-0" title="Opened" />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </ScrollArea>
            </div>

            {/* Conversation view */}
            <div className={`${selectedThread ? 'flex' : 'hidden md:flex'} flex-col flex-1`}>
              {selectedThread ? (
                <>
                  {/* Thread header */}
                  <div className="flex items-center gap-3 px-5 py-3 border-b bg-background">
                    <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={() => setSelectedThreadId(null)}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground truncate">{selectedThread.subject}</h3>
                      <p className="text-xs text-muted-foreground">
                        {selectedThread.messages.length} message{selectedThread.messages.length !== 1 ? 's' : ''} · {selectedThread.participants.filter(p => !isOwnEmail(p)).map(getContactName).join(', ')}
                      </p>
                    </div>
                  </div>

                  {/* Messages */}
                  <ScrollArea className="flex-1 px-5 py-4">
                    <div className="space-y-4">
                      {selectedThread.messages.map(msg => {
                        const isSent = msg.direction === 'outbound';
                        return (
                          <div key={msg.id} className={`rounded-lg border ${isSent ? 'bg-background' : 'bg-muted/30'}`}>
                            <div className="px-4 py-2.5 border-b bg-muted/20">
                              <div className="flex items-center justify-between">
                                <div className="text-xs">
                                  <span className="text-muted-foreground">From: </span>
                                  <span className="font-medium text-foreground">
                                    {isSent ? `${user?.name ?? ''} <${msg.from}>`.trim() : msg.from}
                                  </span>
                                </div>
                                <span className="text-[11px] text-muted-foreground">
                                  {new Date(msg.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-xs mt-0.5">
                                <span className="text-muted-foreground">To: </span>
                                <span className="text-foreground">{msg.to || '—'}</span>
                              </div>
                            </div>
                            <div className="px-4 py-3">
                              <EmailBody body={msg.body} title={msg.subject ? `Email: ${msg.subject}` : undefined} />
                              <MessageAttachments emailId={msg.id} />
                            </div>
                            {msg.direction === 'outbound' && (msg.openedAt || msg.clickedAt || msg.bouncedAt) && (
                              <div className="px-4 pb-2.5 flex items-center gap-3 border-t pt-2">
                                {msg.openedAt && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-emerald-600" title={`Opened ${new Date(msg.openedAt).toLocaleString()}`}>
                                    <Eye className="h-3 w-3" /> Opened
                                  </span>
                                )}
                                {msg.clickedAt && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-blue-600" title={`Clicked ${new Date(msg.clickedAt).toLocaleString()}`}>
                                    <MousePointerClick className="h-3 w-3" /> Clicked
                                  </span>
                                )}
                                {msg.bouncedAt && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-red-500" title={`Bounced ${new Date(msg.bouncedAt).toLocaleString()}`}>
                                    <AlertTriangle className="h-3 w-3" /> Bounced
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>

                  {/* Reply/Forward area */}
                  <div className="border-t p-4">
                    {!replyMode ? (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setReplyMode('reply')} className="gap-1.5">
                          <Reply className="h-3.5 w-3.5" /> Reply
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setReplyMode('forward')} className="gap-1.5">
                          <Forward className="h-3.5 w-3.5" /> Forward
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground">
                            {replyMode === 'reply' ? `Reply to ${getContactName(selectedThread.messages[selectedThread.messages.length - 1].direction === 'inbound' ? selectedThread.messages[selectedThread.messages.length - 1].from : selectedThread.messages[selectedThread.messages.length - 1].to)}` : 'Forward this conversation'}
                          </p>
                          <Button variant="ghost" size="sm" onClick={() => { setReplyMode(null); setReplyBody(''); }} className="h-7 text-xs">
                            Cancel
                          </Button>
                        </div>
                        <div className="flex items-center gap-0.5 px-2 py-1.5 border rounded-t-md bg-muted/30 border-b-0">
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Bold" onMouseDown={e => e.preventDefault()}>
                            <Bold className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Italic" onMouseDown={e => e.preventDefault()}>
                            <Italic className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Link" onMouseDown={e => e.preventDefault()}>
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="List" onMouseDown={e => e.preventDefault()}>
                            <List className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Textarea
                          placeholder={replyMode === 'reply' ? 'Type your reply...' : 'Add a message...'}
                          value={replyBody}
                          onChange={e => setReplyBody(e.target.value)}
                          className="min-h-[100px] rounded-t-none"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={handleSendReply}
                          disabled={!replyBody.trim()}
                          className="gap-1.5"
                        >
                          <Send className="h-3.5 w-3.5" /> Send
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <Mail className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">Select a conversation to read</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ===== ALL EMAILS (admin only) ===== */}
        {isAdmin && (
          <TabsContent value="all-emails" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Input
                  placeholder="Search emails..."
                  value={inboxSearch}
                  onChange={e => setInboxSearch(e.target.value)}
                  className="w-[260px] h-9"
                />
                <p className="text-sm text-muted-foreground">{filteredThreads.length} conversations</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            <div className="flex border rounded-lg bg-background overflow-hidden" style={{ height: 'calc(100vh - 240px)', minHeight: '500px' }}>
              {/* Folder sidebar */}
              <div className="hidden md:flex flex-col border-r w-[52px] min-w-[52px] py-2 gap-1 items-center">
                <button
                  onClick={() => { setInboxFolder('inbox'); setSelectedThreadId(null); }}
                  className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-[10px] w-full transition-colors ${
                    inboxFolder === 'inbox' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'
                  }`}
                  title="Inbox"
                >
                  <Inbox className="h-4 w-4" />
                  <span>Inbox</span>
                </button>
                <button
                  onClick={() => { setInboxFolder('sent'); setSelectedThreadId(null); }}
                  className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-[10px] w-full transition-colors ${
                    inboxFolder === 'sent' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'
                  }`}
                  title="Sent"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  <span>Sent</span>
                </button>
                <button
                  onClick={() => { setInboxFolder('all'); setSelectedThreadId(null); }}
                  className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-[10px] w-full transition-colors ${
                    inboxFolder === 'all' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'
                  }`}
                  title="All Mail"
                >
                  <Layers className="h-4 w-4" />
                  <span>All</span>
                </button>
              </div>
              {/* Thread list */}
              <div className={`${selectedThread ? 'hidden md:flex' : 'flex'} flex-col border-r w-full md:w-[360px] md:min-w-[360px]`}>
                <ScrollArea className="flex-1">
                  {filteredThreads.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                      No conversations found
                    </div>
                  ) : (
                    filteredThreads.map(thread => {
                      const isSelected = selectedThreadId === thread.id;
                      const latestMsg = thread.messages[thread.messages.length - 1];
                      const otherParticipant = thread.participants.find(p => !isOwnEmail(p)) || thread.participants[0];

                      return (
                        <div
                          key={thread.id}
                          onClick={() => handleSelectThread(thread)}
                          className={`px-4 py-3 border-b cursor-pointer transition-colors hover:bg-accent/50 ${
                            isSelected ? 'bg-accent' : ''
                          } ${thread.unreadCount > 0 ? '' : ''}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-0.5">
                              {thread.unreadCount > 0 ? (
                                <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                              ) : (
                                <div className="h-2.5 w-2.5" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className={`text-sm truncate ${thread.unreadCount > 0 ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                                  {getContactName(otherParticipant)}
                                </p>
                                <span className="text-[11px] text-muted-foreground flex-shrink-0">{formatTime(thread.latestAt)}</span>
                              </div>
                              <p className={`text-sm truncate mt-0.5 ${thread.unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                                {thread.subject}
                              </p>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {latestMsg.direction === 'outbound' ? 'You: ' : ''}{latestMsg.body.split('\n')[0].slice(0, 80)}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {thread.messages.length > 1 && (
                                  <span className="text-[11px] text-muted-foreground">{thread.messages.length} messages</span>
                                )}
                                {thread.messages.some(m => m.direction === 'outbound' && m.openedAt) && (
                                  <Eye className="h-3 w-3 text-emerald-500 flex-shrink-0" title="Opened" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </ScrollArea>
              </div>

              {/* Conversation view */}
              <div className={`${selectedThread ? 'flex' : 'hidden md:flex'} flex-col flex-1`}>
                {selectedThread ? (
                  <>
                    {/* Thread header */}
                    <div className="flex items-center gap-3 px-5 py-3 border-b bg-background">
                      <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={() => setSelectedThreadId(null)}>
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate">{selectedThread.subject}</h3>
                        <p className="text-xs text-muted-foreground">
                          {selectedThread.messages.length} message{selectedThread.messages.length !== 1 ? 's' : ''} · {selectedThread.participants.filter(p => !isOwnEmail(p)).map(getContactName).join(', ')}
                        </p>
                      </div>
                    </div>

                    {/* Messages */}
                    <ScrollArea className="flex-1 px-5 py-4">
                      <div className="space-y-4">
                        {selectedThread.messages.map(msg => {
                          const isSent = msg.direction === 'outbound';
                          return (
                            <div key={msg.id} className={`rounded-lg border ${isSent ? 'bg-background' : 'bg-muted/30'}`}>
                              <div className="px-4 py-2.5 border-b bg-muted/20">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">From: </span>
                                    <span className="font-medium text-foreground">
                                      {isSent ? `${user?.name ?? ''} <${msg.from}>`.trim() : msg.from}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-muted-foreground">
                                    {new Date(msg.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                  </span>
                                </div>
                                <div className="text-xs mt-0.5">
                                  <span className="text-muted-foreground">To: </span>
                                  <span className="text-foreground">{msg.to || '—'}</span>
                                </div>
                              </div>
                              <div className="px-4 py-3">
                                <EmailBody body={msg.body} title={msg.subject ? `Email: ${msg.subject}` : undefined} />
                              </div>
                              {msg.direction === 'outbound' && (msg.openedAt || msg.clickedAt || msg.bouncedAt) && (
                                <div className="px-4 pb-2.5 flex items-center gap-3 border-t pt-2">
                                  {msg.openedAt && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-600" title={`Opened ${new Date(msg.openedAt).toLocaleString()}`}>
                                      <Eye className="h-3 w-3" /> Opened
                                    </span>
                                  )}
                                  {msg.clickedAt && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-blue-600" title={`Clicked ${new Date(msg.clickedAt).toLocaleString()}`}>
                                      <MousePointerClick className="h-3 w-3" /> Clicked
                                    </span>
                                  )}
                                  {msg.bouncedAt && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-red-500" title={`Bounced ${new Date(msg.bouncedAt).toLocaleString()}`}>
                                      <AlertTriangle className="h-3 w-3" /> Bounced
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>

                    {/* Reply/Forward area */}
                    <div className="border-t p-4">
                      {!replyMode ? (
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => setReplyMode('reply')} className="gap-1.5">
                            <Reply className="h-3.5 w-3.5" /> Reply
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setReplyMode('forward')} className="gap-1.5">
                            <Forward className="h-3.5 w-3.5" /> Forward
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-muted-foreground">
                              {replyMode === 'reply' ? `Reply to ${getContactName(selectedThread.messages[selectedThread.messages.length - 1].direction === 'inbound' ? selectedThread.messages[selectedThread.messages.length - 1].from : selectedThread.messages[selectedThread.messages.length - 1].to)}` : 'Forward this conversation'}
                            </p>
                            <Button variant="ghost" size="sm" onClick={() => { setReplyMode(null); setReplyBody(''); }} className="h-7 text-xs">
                              Cancel
                            </Button>
                          </div>
                          <div className="flex items-center gap-0.5 px-2 py-1.5 border rounded-t-md bg-muted/30 border-b-0">
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Bold" onMouseDown={e => e.preventDefault()}>
                              <Bold className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Italic" onMouseDown={e => e.preventDefault()}>
                              <Italic className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Link" onMouseDown={e => e.preventDefault()}>
                              <Link2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="List" onMouseDown={e => e.preventDefault()}>
                              <List className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <Textarea
                            placeholder={replyMode === 'reply' ? 'Type your reply...' : 'Add a message...'}
                            value={replyBody}
                            onChange={e => setReplyBody(e.target.value)}
                            className="min-h-[100px] rounded-t-none"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={handleSendReply}
                            disabled={!replyBody.trim()}
                            className="gap-1.5"
                          >
                            <Send className="h-3.5 w-3.5" /> Send
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <Mail className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                      <p className="text-sm text-muted-foreground">Select a conversation to read</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        )}

        {/* ===== COMPOSE ===== */}
        <TabsContent value="compose" className="mt-4">
          <Card className="border shadow-sm max-w-[640px]">
            <CardContent className="p-5 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">To</label>
                <div className="relative">
                  <Input
                    placeholder="Search leads or type an email address..."
                    value={toLeadId ? `${leads.find(l => l.id === toLeadId)?.firstName} ${leads.find(l => l.id === toLeadId)?.lastName} — ${leads.find(l => l.id === toLeadId)?.email}` : (toEmail && !toSearch) ? toEmail : toSearch}
                    onChange={e => { setToSearch(e.target.value); setToLeadId(''); setToEmail(''); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value.trim())) { setToEmail(e.target.value.trim()); } }}
                    onFocus={() => { if (toLeadId || toEmail) { setToSearch(''); setToLeadId(''); setToEmail(''); } }}
                  />
                  {!toLeadId && toSearch && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-background border rounded-md shadow-lg max-h-[200px] overflow-y-auto">
                      {toEmail && (
                        <div
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-accent transition-colors border-b"
                          onClick={() => { setToSearch(''); }}
                        >
                          <Mail className="h-3.5 w-3.5 inline mr-1.5 text-primary" />
                          <span className="font-medium text-foreground">Send to: </span>
                          <span className="text-primary">{toEmail}</span>
                        </div>
                      )}
                      {filteredComposeLeads.map(l => (
                        <div
                          key={l.id}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-accent transition-colors"
                          onClick={() => { setToLeadId(l.id); setToSearch(''); }}
                        >
                          <span className="font-medium text-foreground">{l.firstName} {l.lastName}</span>
                          <span className="text-muted-foreground"> — {l.email}</span>
                          <span className="text-muted-foreground text-xs ml-1">({l.company})</span>
                        </div>
                      ))}
                      {filteredComposeLeads.length === 0 && !toEmail && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No leads found</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Subject</label>
                <Input placeholder="Email subject..." value={subject} onChange={e => setSubject(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Body</label>
                <div className="flex items-center gap-0.5 px-2 py-1.5 border rounded-t-md bg-muted/30 border-b-0">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Bold" onMouseDown={e => e.preventDefault()}>
                    <Bold className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Italic" onMouseDown={e => e.preventDefault()}>
                    <Italic className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Link" onMouseDown={e => e.preventDefault()}>
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="List" onMouseDown={e => e.preventDefault()}>
                    <List className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea placeholder="Write your email..." value={body} onChange={e => setBody(e.target.value)} className="min-h-[200px] rounded-t-none" />
              </div>
              {/* Attachments */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className={attachmentUploading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleAttachFile}
                      disabled={attachmentUploading}
                    />
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Paperclip className="h-3.5 w-3.5" />
                      {attachmentUploading ? 'Uploading...' : 'Attach files'}
                    </span>
                  </label>
                  <span className="text-xs text-muted-foreground">10MB per file · 25MB total</span>
                </div>
                {composeAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {composeAttachments.map((att, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-muted rounded-md px-2 py-1 text-xs">
                        <Paperclip className="h-3 w-3 text-muted-foreground" />
                        <span className="max-w-[120px] truncate">{att.filename}</span>
                        <span className="text-muted-foreground">({(att.size / 1024).toFixed(0)}KB)</span>
                        <button
                          onClick={() => setComposeAttachments(prev => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-foreground ml-0.5"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button onClick={handleSendEmail} disabled={(!toLeadId && !toEmail) || !subject.trim() || !body.trim()} className="gap-1.5">
                <Send className="h-4 w-4" /> Send Email
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== CAMPAIGNS ===== */}
        <TabsContent value="campaigns" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Campaigns</h3>
              <p className="text-xs text-muted-foreground">Create and manage email campaigns</p>
            </div>
            <Button onClick={() => navigate('/outreach/campaign/new')} className="gap-1.5">
              <Plus className="h-4 w-4" /> New Campaign
            </Button>
          </div>
          <CampaignList />
        </TabsContent>

        {/* ===== SEQUENCES ===== */}
        <TabsContent value="sequences" className="mt-4 space-y-3">
          {sequences.map(seq => (
            <Card key={seq.id} className="border shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{seq.name}</h3>
                    <p className="text-xs text-muted-foreground">{seq.steps.length} steps · Created by {profiles.find(p => p.id === seq.createdBy)?.name}</p>
                  </div>
                  <Badge variant={seq.active ? 'default' : 'secondary'}>{seq.active ? 'Active' : 'Paused'}</Badge>
                </div>
                <div className="space-y-2">
                  {seq.steps.map(step => (
                    <div key={step.id} className="flex items-center gap-3 text-sm p-2 rounded bg-muted/50">
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">{step.order}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{step.subject}</p>
                      </div>
                      {step.delayDays > 0 && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" /> +{step.delayDays}d
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
          <p className="text-xs text-muted-foreground text-center py-2">Sequence execution will be powered by email API integration</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
