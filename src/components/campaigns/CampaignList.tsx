import { useNavigate } from 'react-router-dom';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useEmails } from '@/hooks/use-emails';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Eye, MousePointerClick, AlertTriangle, Copy, Trash2, BarChart3, PauseCircle, PlayCircle } from 'lucide-react';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  active: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-violet-100 text-violet-700',
};

export default function CampaignList() {
  const { campaigns, deleteCampaign, cloneCampaign, updateCampaign } = useCampaigns();
  const { emails } = useEmails();
  const navigate = useNavigate();

  const getCampaignStats = (campaignId: string) => {
    const campaignEmails = emails.filter(
      e => e.campaignId === campaignId && e.direction === 'outbound',
    );
    return {
      sent: campaignEmails.length,
      opened: campaignEmails.filter(e => e.openedAt).length,
      clicked: campaignEmails.filter(e => e.clickedAt).length,
      bounced: campaignEmails.filter(e => e.bouncedAt).length,
    };
  };

  const handleClone = async (id: string) => {
    try {
      await cloneCampaign(id);
      toast.success('Campaign cloned');
    } catch {
      toast.error('Failed to clone campaign');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCampaign(id);
      toast.success('Campaign deleted');
    } catch {
      toast.error('Failed to delete campaign');
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="text-sm font-medium text-foreground">No campaigns yet</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Send your first campaign from the AI or Manual mode above.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Campaign History</h3>
        <span className="text-xs text-muted-foreground">
          {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
        </span>
      </div>
      {campaigns.map(campaign => {
        const stats = getCampaignStats(campaign.id);
        const openRate = stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0;
        return (
          <Card
            key={campaign.id}
            className="border shadow-sm hover:bg-accent/30 transition-colors cursor-pointer"
            onClick={() => navigate(`/outreach/campaign/${campaign.id}`)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium text-foreground">
                    {campaign.name || campaign.subject}
                  </h4>
                  <Badge
                    className={`text-[10px] ${statusColors[campaign.status] ?? statusColors.completed}`}
                  >
                    {campaign.status}
                  </Badge>
                </div>
                <div
                  className="flex items-center gap-1"
                  onClick={e => e.stopPropagation()}
                >
                  {campaign.status === 'active' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Pause"
                      onClick={(e) => { e.stopPropagation(); updateCampaign(campaign.id, { status: 'paused' }); toast.success('Paused'); }}
                    >
                      <PauseCircle className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {campaign.status === 'paused' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Resume"
                      onClick={(e) => { e.stopPropagation(); updateCampaign(campaign.id, { status: 'active' }); toast.success('Resumed'); }}
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {campaign.status === 'scheduled' && (
                    <span className="text-[10px] text-muted-foreground">{campaign.scheduledAt ? new Date(campaign.scheduledAt).toLocaleDateString() : ''}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Clone"
                    onClick={() => handleClone(campaign.id)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    title="Delete"
                    onClick={() => handleDelete(campaign.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground truncate mb-3">{campaign.subject}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{stats.sent} sent</span>
                <span className="flex items-center gap-0.5">
                  <Eye className="h-3 w-3" /> {stats.opened} ({openRate}%)
                </span>
                <span className="flex items-center gap-0.5">
                  <MousePointerClick className="h-3 w-3" /> {stats.clicked}
                </span>
                {stats.bounced > 0 && (
                  <span className="flex items-center gap-0.5 text-red-500">
                    <AlertTriangle className="h-3 w-3" /> {stats.bounced}
                  </span>
                )}
                <span className="ml-auto">
                  {new Date(campaign.sentAt).toLocaleDateString()}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
