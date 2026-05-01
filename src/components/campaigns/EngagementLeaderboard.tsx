import { useEngagement } from '@/hooks/use-engagement';
import { useLeads } from '@/hooks/use-leads';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flame, Eye, MousePointerClick, MessageSquare } from 'lucide-react';

export default function EngagementLeaderboard() {
  const { topLeads, isLoading } = useEngagement(10);
  const { leads } = useLeads();

  if (isLoading) return <div className="text-xs text-muted-foreground">Loading engagement data...</div>;
  if (topLeads.length === 0) return null;

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-500" /> Hottest Leads
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {topLeads.map((entry, i) => {
          const lead = leads.find(l => l.id === entry.leadId);
          if (!lead) return null;
          return (
            <div key={entry.leadId} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
              <span className="text-sm font-bold text-muted-foreground w-5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{lead.firstName} {lead.lastName}</p>
                <p className="text-xs text-muted-foreground truncate">{lead.company}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {entry.opens > 0 && <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{entry.opens}</span>}
                {entry.clicks > 0 && <span className="flex items-center gap-0.5"><MousePointerClick className="h-3 w-3" />{entry.clicks}</span>}
                {entry.replies > 0 && <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{entry.replies}</span>}
              </div>
              <Badge variant="secondary" className="text-[10px] bg-orange-50 text-orange-700">{entry.score}</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
