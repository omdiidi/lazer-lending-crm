import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useEmails } from '@/hooks/use-emails';
import { useLeads } from '@/hooks/use-leads';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getCampaignABAnalytics } from '@/lib/api/campaigns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Copy, PauseCircle, PlayCircle, FlaskConical, Pencil, Save, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import CampaignAnalytics from '@/components/campaigns/CampaignAnalytics';
import type { CampaignEnrollment } from '@/types/crm';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  active: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-violet-100 text-violet-700',
};

// Formats an ISO timestamp as "Thu Mar 27 at 9:00 AM" in the user's local timezone
function formatSendTime(isoString: string): string {
  const date = new Date(isoString);
  const datePart = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart} at ${timePart}`;
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { campaigns, cloneCampaign, updateCampaign } = useCampaigns();
  const { emails } = useEmails();
  const { leads } = useLeads();
  const queryClient = useQueryClient();

  const campaign = campaigns.find(c => c.id === id);
  const campaignEmails = emails.filter(e => e.campaignId === id && e.direction === 'outbound');

  // Get enrollments for this campaign
  const [enrollments, setEnrollments] = useState<
    Pick<CampaignEnrollment, 'id' | 'leadId' | 'email' | 'status' | 'currentStep' | 'nextSendAt' | 'sentAt'>[]
  >([]);
  useEffect(() => {
    if (!id) return;
    supabase.from('campaign_enrollments')
      .select('id, lead_id, email, status, current_step, next_send_at, sent_at')
      .eq('campaign_id', id)
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load enrollments:', error);
          return;
        }
        if (data) setEnrollments(data.map(e => ({
          id: e.id,
          leadId: e.lead_id,
          email: e.email,
          status: e.status,
          currentStep: e.current_step,
          nextSendAt: e.next_send_at,
          sentAt: e.sent_at,
        })));
      });
  }, [id]);

  const sortedEnrollments = [...enrollments].sort((a, b) => {
    const aIsPending = a.status === 'pending';
    const bIsPending = b.status === 'pending';

    if (aIsPending && !bIsPending) return -1;
    if (!aIsPending && bIsPending) return 1;

    if (aIsPending && bIsPending) {
      if (!a.nextSendAt && !b.nextSendAt) return 0;
      if (!a.nextSendAt) return 1;
      if (!b.nextSendAt) return -1;
      return new Date(a.nextSendAt).getTime() - new Date(b.nextSendAt).getTime();
    }

    if (!a.sentAt && !b.sentAt) return 0;
    if (!a.sentAt) return 1;
    if (!b.sentAt) return -1;
    return new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
  });

  const [abStats, setAbStats] = useState<{ a: { sent: number; opened: number; clicked: number; bounced: number }; b: { sent: number; opened: number; clicked: number; bounced: number } } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editVariantBSubject, setEditVariantBSubject] = useState('');
  const [editVariantBBody, setEditVariantBBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (campaign?.abTestEnabled && id) {
      getCampaignABAnalytics(id).then(setAbStats);
    }
  }, [campaign, id]);

  if (!campaign) {
    return (
      <div className="p-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/outreach')}
          className="gap-1.5 mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Outreach
        </Button>
        <p className="text-muted-foreground">Campaign not found.</p>
      </div>
    );
  }

  const isEditable = ['active', 'paused', 'scheduled'].includes(campaign.status);

  const stats = {
    sent: campaignEmails.length,
    opened: campaignEmails.filter(e => e.openedAt).length,
    clicked: campaignEmails.filter(e => e.clickedAt).length,
    bounced: campaignEmails.filter(e => e.bouncedAt).length,
    unsubscribed: 0, // TODO: count from unsubscribes table
  };

  const handleClone = async () => {
    try {
      await cloneCampaign(campaign.id);
      toast.success('Campaign cloned');
      navigate('/outreach');
    } catch {
      toast.error('Failed to clone');
    }
  };

  const handlePause = async () => {
    try {
      await updateCampaign(campaign.id, { status: 'paused' });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign paused');
    } catch {
      toast.error('Failed to pause');
    }
  };

  const handleResume = async () => {
    try {
      await updateCampaign(campaign.id, { status: 'active' });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign resumed');
    } catch {
      toast.error('Failed to resume');
    }
  };

  const handleStartEdit = () => {
    setEditSubject(campaign.subject);
    setEditBody(campaign.body);
    setEditVariantBSubject(campaign.variantBSubject || '');
    setEditVariantBBody(campaign.variantBBody || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!editSubject.trim() || !editBody.trim()) {
      toast.error('Subject and body are required');
      return;
    }
    setSaving(true);
    try {
      await updateCampaign(campaign.id, {
        subject: editSubject,
        body: editBody,
        ...(campaign.abTestEnabled && {
          variantBSubject: editVariantBSubject,
          variantBBody: editVariantBBody,
        }),
      });
      setIsEditing(false);
      toast.success('Campaign content updated');
    } catch {
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-[1000px] space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/outreach')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {campaign.name || campaign.subject}
            </h1>
            <p className="text-xs text-muted-foreground">
              Sent {new Date(campaign.sentAt).toLocaleString()} &middot;{' '}
              {campaign.recipientIds.length} recipients
            </p>
            {campaign.scheduledAt && campaign.status === 'scheduled' && (
              <p className="text-xs text-muted-foreground">Scheduled for {new Date(campaign.scheduledAt).toLocaleString()}</p>
            )}
          </div>
          <Badge
            className={`text-xs ${statusColors[campaign.status] ?? statusColors.completed}`}
          >
            {campaign.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {(campaign.status === 'active' || campaign.status === 'scheduled') && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePause}>
              <PauseCircle className="h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {campaign.status === 'paused' && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleResume}>
              <PlayCircle className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleClone}>
            <Copy className="h-3.5 w-3.5" /> Clone Campaign
          </Button>
        </div>
      </div>

      {campaign.status === 'paused' && (
        <Card className="border-amber-300 bg-amber-50 border">
          <CardContent className="p-4 flex items-center gap-3">
            <PauseCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">Campaign Paused</p>
              <p className="text-xs text-amber-600">No emails are being sent. Click Resume to continue sending.</p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-100" onClick={handleResume}>
              <PlayCircle className="h-3.5 w-3.5" /> Resume
            </Button>
          </CardContent>
        </Card>
      )}

      <CampaignAnalytics {...stats} />

      {campaign.abTestEnabled && abStats && (
        <Card className="border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><FlaskConical className="h-4 w-4" /> A/B Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-foreground">Variant A</h4>
                <p className="text-xs text-muted-foreground truncate">{campaign.subject}</p>
                <div className="text-xs space-y-1">
                  <p>Sent: {abStats.a.sent}</p>
                  <p>Opened: {abStats.a.opened} ({abStats.a.sent > 0 ? Math.round((abStats.a.opened / abStats.a.sent) * 100) : 0}%)</p>
                  <p>Clicked: {abStats.a.clicked}</p>
                  <p>Bounced: {abStats.a.bounced}</p>
                </div>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-foreground">Variant B</h4>
                <p className="text-xs text-muted-foreground truncate">{campaign.variantBSubject}</p>
                <div className="text-xs space-y-1">
                  <p>Sent: {abStats.b.sent}</p>
                  <p>Opened: {abStats.b.opened} ({abStats.b.sent > 0 ? Math.round((abStats.b.opened / abStats.b.sent) * 100) : 0}%)</p>
                  <p>Clicked: {abStats.b.clicked}</p>
                  <p>Bounced: {abStats.b.bounced}</p>
                </div>
              </div>
            </div>
            {abStats.a.sent >= 5 && abStats.b.sent >= 5 && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground">
                  {abStats.a.opened / Math.max(abStats.a.sent, 1) > abStats.b.opened / Math.max(abStats.b.sent, 1)
                    ? `Variant A is winning with a ${Math.round((abStats.a.opened / abStats.a.sent) * 100)}% open rate vs ${Math.round((abStats.b.opened / abStats.b.sent) * 100)}% for Variant B.`
                    : abStats.b.opened / Math.max(abStats.b.sent, 1) > abStats.a.opened / Math.max(abStats.a.sent, 1)
                      ? `Variant B is winning with a ${Math.round((abStats.b.opened / abStats.b.sent) * 100)}% open rate vs ${Math.round((abStats.a.opened / abStats.a.sent) * 100)}% for Variant A.`
                      : 'Both variants are performing equally so far.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Email Content</CardTitle>
          {isEditable && !isEditing && (
            <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={handleStartEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
          {isEditing && (
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={handleCancelEdit}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button size="sm" className="gap-1 h-7" onClick={handleSaveEdit} disabled={saving}>
                <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {isEditing ? (
            <>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Subject</p>
                <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Body</p>
                <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={6} />
              </div>
              {campaign.abTestEnabled && (
                <>
                  <div className="space-y-1.5 pt-2 border-t">
                    <p className="text-xs text-muted-foreground">Variant B Subject</p>
                    <Input value={editVariantBSubject} onChange={e => setEditVariantBSubject(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Variant B Body</p>
                    <Textarea value={editVariantBBody} onChange={e => setEditVariantBBody(e.target.value)} rows={6} />
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div>
                <p className="text-xs text-muted-foreground">Subject</p>
                <p className="text-sm font-medium">{campaign.subject}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Body</p>
                <p className="text-sm whitespace-pre-line text-foreground">{campaign.body}</p>
              </div>
              {campaign.abTestEnabled && (
                <>
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground">Variant B Subject</p>
                    <p className="text-sm font-medium">{campaign.variantBSubject}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Variant B Body</p>
                    <p className="text-sm whitespace-pre-line text-foreground">{campaign.variantBBody}</p>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recipients ({enrollments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Step</TableHead>
                <TableHead className="text-xs">Scheduled / Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedEnrollments.map(enrollment => {
                const lead = leads.find(l => l.id === enrollment.leadId);
                const matchedEmail = campaignEmails.find(
                  e => (enrollment.leadId && e.leadId === enrollment.leadId) || e.to === enrollment.email
                );

                const isPending = enrollment.status === 'pending';
                const displayStatus = isPending
                  ? 'Pending'
                  : matchedEmail?.bouncedAt
                    ? 'Bounced'
                    : matchedEmail?.clickedAt
                      ? 'Clicked'
                      : matchedEmail?.openedAt
                        ? 'Opened'
                        : enrollment.status === 'replied'
                          ? 'Replied'
                          : enrollment.status === 'bounced'
                            ? 'Bounced'
                            : enrollment.status === 'failed'
                              ? 'Failed'
                              : enrollment.status === 'unsubscribed'
                                ? 'Unsubscribed'
                                : 'Delivered';

                const statusColor = displayStatus === 'Pending'
                  ? 'text-muted-foreground'
                  : displayStatus === 'Bounced' || displayStatus === 'Failed'
                    ? 'text-red-500'
                    : displayStatus === 'Clicked'
                      ? 'text-blue-600'
                      : displayStatus === 'Opened'
                        ? 'text-emerald-600'
                        : displayStatus === 'Replied'
                          ? 'text-violet-600'
                          : displayStatus === 'Unsubscribed'
                            ? 'text-amber-600'
                            : 'text-muted-foreground';

                const scheduleDisplay = isPending
                  ? (enrollment.nextSendAt ? formatSendTime(enrollment.nextSendAt) : 'Pending')
                  : (enrollment.sentAt ? formatSendTime(enrollment.sentAt) : '—');

                return (
                  <TableRow key={enrollment.id}>
                    <TableCell className="text-xs">
                      {lead ? `${lead.firstName} ${lead.lastName}` : enrollment.email.split('@')[0]}
                    </TableCell>
                    <TableCell className="text-xs">{enrollment.email}</TableCell>
                    <TableCell className={`text-xs font-medium ${statusColor}`}>
                      {displayStatus}
                    </TableCell>
                    <TableCell className="text-xs">
                      Step {enrollment.currentStep + 1}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {scheduleDisplay}
                    </TableCell>
                  </TableRow>
                );
              })}
              {enrollments.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-xs text-muted-foreground py-4"
                  >
                    No recipients enrolled yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
