import { Card, CardContent } from '@/components/ui/card';
import { Send, Eye, MousePointerClick, AlertTriangle, MailX } from 'lucide-react';

interface CampaignAnalyticsProps {
  sent: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
}

export default function CampaignAnalytics({
  sent,
  opened,
  clicked,
  bounced,
  unsubscribed,
}: CampaignAnalyticsProps) {
  const rate = (n: number) => (sent > 0 ? `${Math.round((n / sent) * 100)}%` : '0%');

  const stats = [
    { label: 'Sent', value: sent, icon: Send, color: 'text-foreground', rate: undefined },
    { label: 'Opened', value: opened, rate: rate(opened), icon: Eye, color: 'text-emerald-600' },
    {
      label: 'Clicked',
      value: clicked,
      rate: rate(clicked),
      icon: MousePointerClick,
      color: 'text-blue-600',
    },
    {
      label: 'Bounced',
      value: bounced,
      rate: rate(bounced),
      icon: AlertTriangle,
      color: 'text-red-500',
    },
    {
      label: 'Unsubscribed',
      value: unsubscribed,
      rate: rate(unsubscribed),
      icon: MailX,
      color: 'text-amber-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {stats.map(s => (
        <Card key={s.label} className="border">
          <CardContent className="p-3 text-center">
            <s.icon className={`h-4 w-4 mx-auto mb-1 ${s.color}`} />
            <p className={`text-lg font-semibold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
            {s.rate && <p className="text-[10px] text-muted-foreground">{s.rate}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
