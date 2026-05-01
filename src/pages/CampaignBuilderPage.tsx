import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads } from '@/hooks/use-leads';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Send, Save, Eye, Users, FileText, FlaskConical, Zap, Clock } from 'lucide-react';
import AudienceSelector from '@/components/campaigns/AudienceSelector';
import TemplateEditor from '@/components/campaigns/TemplateEditor';
import SequenceEditor from '@/components/campaigns/SequenceEditor';
import ABVariantEditor from '@/components/campaigns/ABVariantEditor';
import { searchApollo } from '@/lib/api/apollo';
import { applyMergeFields } from '@/lib/merge-fields';

// WARMUP TIERS — duplicated in supabase/functions/process-campaigns/index.ts
// Keep both in sync when modifying.
const WARMUP_TIERS = [
  { value: 5, label: '5/day', unlocksAfterDays: 0 },
  { value: 10, label: '10/day', unlocksAfterDays: 0 },
  { value: 15, label: '15/day', unlocksAfterDays: 0 },
  { value: 20, label: '20/day', unlocksAfterDays: 0 },
  { value: 25, label: '25/day', unlocksAfterDays: 8 },
  { value: 50, label: '50/day', unlocksAfterDays: 15 },
  { value: 75, label: '75/day', unlocksAfterDays: 22 },
  { value: 100, label: '100/day', unlocksAfterDays: 31 },
  { value: 150, label: '150/day', unlocksAfterDays: 61 },
  { value: 200, label: '200/day', unlocksAfterDays: 91 },
]

export default function CampaignBuilderPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { leads, addLeads } = useLeads();
  const { addCampaignAsync, createEnrollments, createSequenceWithSteps } = useCampaigns();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [campaignName, setCampaignName] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [useSequence, setUseSequence] = useState(false);
  const [followUps, setFollowUps] = useState<{ subject: string; body: string; delayDays: number }[]>([]);

  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [variantBSubject, setVariantBSubject] = useState('');
  const [variantBBody, setVariantBBody] = useState('');
  const [smartSend, setSmartSend] = useState(false);
  const [dailySendLimit, setDailySendLimit] = useState(20);
  const [sendSpacing, setSendSpacing] = useState(false);
  const [warmupDays, setWarmupDays] = useState(0);

  // Apollo auto-gen state
  const [showApolloGen, setShowApolloGen] = useState(false);
  const [apolloPrompt, setApolloPrompt] = useState('');
  const [apolloCount, setApolloCount] = useState(25);
  const [apolloLoading, setApolloLoading] = useState(false);


  useEffect(() => {
    supabase.from('warmup_state').select('*').eq('id', 'default').maybeSingle()
      .then(({ data }) => {
        if (data?.first_email_at) {
          const days = Math.floor((Date.now() - new Date(data.first_email_at).getTime()) / (24*60*60*1000))
          setWarmupDays(days)
        }
      })
  }, [])


  // Only show leads with verified emails
  const emailSafeLeads = useMemo(() =>
    leads.filter(l => l.emailStatus === 'verified' || l.emailStatus === 'likely_to_engage'),
    [leads]
  );

  // Get a sample lead for preview
  const sampleLead = useMemo(() => {
    const firstId = Array.from(selectedLeadIds)[0];
    return leads.find(l => l.id === firstId);
  }, [leads, selectedLeadIds]);

  // Preview with merge fields replaced
  const previewSubject = sampleLead
    ? applyMergeFields(subject, sampleLead)
    : subject;
  const previewBody = sampleLead
    ? applyMergeFields(body, sampleLead).replace(/\{\{unsubscribeLink\}\}/g, '#unsubscribe')
    : body;

  const canProceedStep1 = campaignName.trim() && selectedLeadIds.size > 0;
  const canProceedStep2 = subject.trim() && body.trim();

  const handleSend = async () => {
    if (!user?.emailPrefix) {
      toast.error('Set your sending email in Settings before sending');
      return;
    }

    if (sendMode === 'schedule') {
      if (!scheduledAt) { toast.error('Select a date and time'); return; }
      try {
        let sequenceId: string | undefined;
        if (useSequence && followUps.length > 0) {
          const allSteps = [
            { subject: subject.trim(), body: body.trim(), delayDays: 0 },
            ...followUps.map(f => ({ subject: f.subject.trim(), body: f.body.trim(), delayDays: f.delayDays })),
          ];
          sequenceId = await createSequenceWithSteps(allSteps, user.id);
        }
        const campaign = await addCampaignAsync({
          name: campaignName.trim(),
          subject: subject.trim(),
          body: body.trim(),
          recipientIds: Array.from(selectedLeadIds),
          sentAt: new Date().toISOString(),
          sentBy: user.id,
          status: 'scheduled',
          scheduledAt: new Date(scheduledAt).toISOString(),
          abTestEnabled,
          variantBSubject: abTestEnabled ? variantBSubject.trim() : undefined,
          variantBBody: abTestEnabled ? variantBBody.trim() : undefined,
          sequenceId: sequenceId || undefined,
          smartSend,
          dailySendLimit,
          sendSpacing,
        });
        const recipients = Array.from(selectedLeadIds).map(leadId => {
          const lead = leads.find(l => l.id === leadId);
          return { leadId, email: lead?.email || '' };
        }).filter(r => r.email);
        await createEnrollments(campaign.id, recipients);
        toast.success(`Campaign scheduled for ${new Date(scheduledAt).toLocaleString()}`);
        navigate('/outreach');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to schedule campaign');
      }
      return;
    }

    setSending(true);
    try {
      // Create sequence if multi-step
      let sequenceId: string | undefined;
      if (useSequence && followUps.length > 0) {
        const allSteps = [
          { subject: subject.trim(), body: body.trim(), delayDays: 0 },
          ...followUps.map(f => ({ subject: f.subject.trim(), body: f.body.trim(), delayDays: f.delayDays })),
        ];
        sequenceId = await createSequenceWithSteps(allSteps, user.id);
      }

      // Create campaign as active — scheduler will handle sending
      const campaign = await addCampaignAsync({
        name: campaignName.trim(),
        subject: subject.trim(),
        body: body.trim(),
        recipientIds: Array.from(selectedLeadIds),
        sentAt: new Date().toISOString(),
        sentBy: user.id,
        status: 'active',
        abTestEnabled,
        variantBSubject: abTestEnabled ? variantBSubject.trim() : undefined,
        variantBBody: abTestEnabled ? variantBBody.trim() : undefined,
        sequenceId: sequenceId || undefined,
        smartSend,
        dailySendLimit,
        sendSpacing,
      });

      // Create pending enrollments — scheduler picks these up
      const enrollmentRecipients = Array.from(selectedLeadIds).map(leadId => {
        const lead = leads.find(l => l.id === leadId);
        if (useSequence && followUps.length > 0) {
          const nextSendAt = new Date(Date.now() + followUps[0].delayDays * 24 * 60 * 60 * 1000).toISOString();
          return { leadId, email: lead?.email || '', currentStep: 0, nextSendAt };
        }
        return { leadId, email: lead?.email || '' };
      }).filter(r => r.email);
      await createEnrollments(campaign.id, enrollmentRecipients);

      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign is now active. Emails will send according to your daily limit.');
      navigate('/outreach?tab=campaigns');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!user) return;
    try {
      await addCampaignAsync({
        name: campaignName.trim() || 'Untitled Campaign',
        subject: subject.trim(),
        body: body.trim(),
        recipientIds: Array.from(selectedLeadIds),
        sentAt: new Date().toISOString(),
        sentBy: user.id,
        status: 'draft',
        abTestEnabled: false,
      });
      toast.success('Campaign saved as draft');
      navigate('/outreach');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save draft');
    }
  };

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/outreach')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">New Campaign</h1>
            <p className="text-xs text-muted-foreground">Step {step} of 4</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Step indicators */}
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`h-2 w-8 rounded-full ${s <= step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>
      </div>

      {/* Step 1: Name + Audience */}
      {step === 1 && (
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Campaign Name & Audience</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Campaign Name</Label>
              <Input placeholder="e.g., Q1 SaaS Outreach" value={campaignName} onChange={e => setCampaignName(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 mb-4">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowApolloGen(true)}>
                <Zap className="h-3.5 w-3.5" /> Auto-Generate Leads
              </Button>
              <span className="text-xs text-muted-foreground">Search Apollo.io for leads matching your ideal customer profile</span>
            </div>
            <AudienceSelector
              leads={emailSafeLeads}
              selectedIds={selectedLeadIds}
              onSelectionChange={setSelectedLeadIds}
            />
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!canProceedStep1} className="gap-1.5">
                Next: Template <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Template */}
      {step === 2 && (
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Email Template</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 mb-4">
              <Button variant={!useSequence ? 'default' : 'outline'} size="sm" onClick={() => setUseSequence(false)}>
                Single Email
              </Button>
              <Button variant={useSequence ? 'default' : 'outline'} size="sm" onClick={() => setUseSequence(true)}>
                Multi-Step Sequence
              </Button>
            </div>
            {!useSequence ? (
              <TemplateEditor subject={subject} body={body} onSubjectChange={setSubject} onBodyChange={setBody} />
            ) : (
              <SequenceEditor
                introSubject={subject}
                introBody={body}
                onIntroSubjectChange={setSubject}
                onIntroBodyChange={setBody}
                followUps={followUps}
                onFollowUpsChange={setFollowUps}
              />
            )}
            {!useSequence && (
              <div className="space-y-3 mt-4 pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Button
                    variant={abTestEnabled ? 'default' : 'outline'}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setAbTestEnabled(!abTestEnabled)}
                  >
                    <FlaskConical className="h-3.5 w-3.5" /> {abTestEnabled ? 'A/B Test Enabled' : 'Enable A/B Test'}
                  </Button>
                  {abTestEnabled && <span className="text-xs text-muted-foreground">Variant A is your template above. Add Variant B below.</span>}
                </div>
                {abTestEnabled && (
                  <ABVariantEditor
                    subject={variantBSubject}
                    body={variantBBody}
                    onSubjectChange={setVariantBSubject}
                    onBodyChange={setVariantBBody}
                  />
                )}
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button onClick={() => setStep(3)} disabled={!canProceedStep2} className="gap-1.5">
                Next: Preview <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Preview */}
      {step === 3 && (
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Eye className="h-4 w-4" /> Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sampleLead && (
              <p className="text-xs text-muted-foreground">Previewing with: {sampleLead.firstName} {sampleLead.lastName} at {sampleLead.company}</p>
            )}
            <Card className="border bg-muted/20">
              <CardContent className="p-4 space-y-3">
                <div className="text-xs">
                  <span className="text-muted-foreground">From: </span>
                  <span className="font-medium">{user?.name} &lt;{user?.emailPrefix ? `${user.emailPrefix}@mail.integrateapi.ai` : 'not set'}&gt;</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">To: </span>
                  <span>{sampleLead ? sampleLead.email : 'recipient@example.com'}</span>
                </div>
                <div className="border-t pt-3">
                  <p className="text-sm font-medium">{previewSubject || '(no subject)'}</p>
                </div>
                <div className="border-t pt-3">
                  <p className="text-sm whitespace-pre-line leading-relaxed">{previewBody || '(no body)'}</p>
                </div>
              </CardContent>
            </Card>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>This email will be sent to <strong>{selectedLeadIds.size}</strong> recipients</span>
              {!user?.emailPrefix && <Badge variant="destructive" className="text-[10px]">Set sending email in Settings</Badge>}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button onClick={() => setStep(4)} className="gap-1.5">
                Next: Confirm <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirm + Send */}
      {step === 4 && (
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Send className="h-4 w-4" /> Confirm & Send</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Campaign</p>
                <p className="font-medium">{campaignName}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Recipients</p>
                <p className="font-medium">{selectedLeadIds.size} leads</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Subject</p>
                <p className="font-medium truncate">{subject}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">From</p>
                <p className="font-medium">{user?.emailPrefix ? `${user.emailPrefix}@mail.integrateapi.ai` : 'Not set'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Daily limit:</span>
                <Select value={String(dailySendLimit)} onValueChange={v => setDailySendLimit(Number(v))}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WARMUP_TIERS.map(tier => (
                      <SelectItem
                        key={tier.value}
                        value={String(tier.value)}
                        disabled={warmupDays < tier.unlocksAfterDays}
                      >
                        {tier.label}{warmupDays < tier.unlocksAfterDays ? ` (${tier.unlocksAfterDays - warmupDays}d)` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant={sendSpacing ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => setSendSpacing(!sendSpacing)}
              >
                <Clock className="h-3.5 w-3.5" /> {sendSpacing ? 'Spacing On' : 'Space Emails'}
              </Button>
              {sendSpacing && <span className="text-xs text-muted-foreground">Emails will be spread evenly throughout the day</span>}
            </div>
            <div className="flex items-center gap-3 mb-4">
              <Button
                variant={smartSend ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => setSmartSend(!smartSend)}
              >
                <Clock className="h-3.5 w-3.5" /> {smartSend ? 'Smart Send On' : 'Optimize Send Time'}
              </Button>
              {smartSend && <span className="text-xs text-muted-foreground">Emails will send at 9 AM in each recipient's local timezone</span>}
            </div>
            <div className="flex items-center gap-3 mb-4">
              <Button variant={sendMode === 'now' ? 'default' : 'outline'} size="sm" onClick={() => setSendMode('now')}>
                Send Now
              </Button>
              <Button variant={sendMode === 'schedule' ? 'default' : 'outline'} size="sm" onClick={() => setSendMode('schedule')}>
                Schedule
              </Button>
            </div>
            {sendMode === 'schedule' && (
              <div className="space-y-2 mb-4">
                <Label>Send Date & Time</Label>
                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} min={new Date().toISOString().slice(0, 16)} />
              </div>
            )}
            <div className="flex justify-between pt-4">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(3)} className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </Button>
                <Button variant="outline" onClick={handleSaveDraft} className="gap-1.5">
                  <Save className="h-3.5 w-3.5" /> Save as Draft
                </Button>
              </div>
              <Button onClick={handleSend} disabled={sending || !user?.emailPrefix} className="gap-1.5">
                <Send className="h-3.5 w-3.5" /> {sending ? 'Sending...' : sendMode === 'schedule' ? `Schedule for ${selectedLeadIds.size} Recipients` : `Send to ${selectedLeadIds.size} Recipients`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showApolloGen} onOpenChange={setShowApolloGen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Leads via Apollo</DialogTitle>
            <DialogDescription>Describe your ideal customer and we'll search Apollo.io for matching contacts.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Describe your ideal customer</Label>
              <Textarea placeholder="e.g., CTOs at SaaS companies, 50-200 employees, based in Austin" value={apolloPrompt} onChange={e => setApolloPrompt(e.target.value)} className="min-h-[80px]" />
            </div>
            <div className="space-y-2">
              <Label>Number of leads</Label>
              <Select value={String(apolloCount)} onValueChange={v => setApolloCount(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 leads</SelectItem>
                  <SelectItem value="25">25 leads</SelectItem>
                  <SelectItem value="50">50 leads</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">Estimated Apollo credits: ~{apolloCount * 2}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApolloGen(false)}>Cancel</Button>
            <Button onClick={async () => {
              setApolloLoading(true);
              try {
                const result = await searchApollo(apolloPrompt, apolloCount);
                if (result.leads.length > 0) {
                  const cleaned = result.leads.map(({ id: _id, createdAt: _createdAt, ...rest }) => ({ ...rest, assignedTo: user!.id }));
                  addLeads(cleaned);
                  toast.success(`${result.leads.length} leads generated and imported. Select them in the audience below.`);
                } else {
                  toast.error('No leads found. Try broadening your search.');
                }
                setShowApolloGen(false);
                setApolloPrompt('');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Apollo search failed');
              } finally {
                setApolloLoading(false);
              }
            }} disabled={apolloLoading || !apolloPrompt.trim()} className="gap-1.5">
              <Zap className="h-3.5 w-3.5" /> {apolloLoading ? 'Searching...' : 'Generate Leads'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
