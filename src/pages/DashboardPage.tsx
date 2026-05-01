import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeads } from '@/hooks/use-leads';
import { useActivities } from '@/hooks/use-activities';
import { useDeals } from '@/hooks/use-deals';
import { useProfiles } from '@/hooks/use-profiles';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Phone, Mail, TrendingUp, DollarSign, ListTodo } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import EngagementLeaderboard from '@/components/campaigns/EngagementLeaderboard';
import { TodoDashboardWidgets } from '@/components/todo/TodoDashboardWidgets';

const statusColors: Record<string, string> = {
  cold: 'hsl(217.2 91.2% 59.8%)',
  lukewarm: 'hsl(38 92% 50%)',
  warm: 'hsl(25 95% 53%)',
  dead: 'hsl(0 72% 51%)',
};

export default function DashboardPage() {
  const { leads, isLoading: leadsLoading } = useLeads();
  const { activities, isLoading: activitiesLoading } = useActivities();
  const { deals, isLoading: dealsLoading } = useDeals();
  const { profiles } = useProfiles();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const totalLeads = leads.length;
  const callsMade = activities.filter(a => a.type === 'call').length;
  const emailsSent = activities.filter(a => a.type === 'email_sent').length;
  const warmLeads = leads.filter(l => l.status === 'warm').length;
  const conversionRate = totalLeads > 0 ? ((warmLeads / totalLeads) * 100).toFixed(1) : '0';
  const pipelineValue = deals.filter(d => d.stage !== 'closed_lost').reduce((sum, d) => sum + d.value, 0);

  const funnelData = [
    { name: 'Cold', value: leads.filter(l => l.status === 'cold').length },
    { name: 'Lukewarm', value: leads.filter(l => l.status === 'lukewarm').length },
    { name: 'Warm', value: leads.filter(l => l.status === 'warm').length },
    { name: 'Dead', value: leads.filter(l => l.status === 'dead').length },
  ];

  const weeklyActivity = useMemo(() => {
    const now = new Date();
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayActivities = activities.filter(a => a.timestamp.startsWith(dayStr));
      result.push({
        day: dayName,
        calls: dayActivities.filter(a => a.type === 'call').length,
        emails: dayActivities.filter(a => a.type === 'email_sent').length,
      });
    }
    return result;
  }, [activities]);

  const revenueData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = d.toLocaleString('en-US', { month: 'short' });
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const monthDeals = deals.filter(deal => {
        const created = new Date(deal.createdAt);
        return created >= monthStart && created <= monthEnd && deal.stage !== 'closed_lost';
      });
      months.push({
        month: monthStr,
        value: monthDeals.reduce((sum, d) => sum + d.value, 0),
      });
    }
    return months;
  }, [deals]);

  const stats = [
    { label: 'Total Leads', value: totalLeads, icon: Users },
    { label: 'Calls Made', value: callsMade, icon: Phone },
    { label: 'Emails Sent', value: emailsSent, icon: Mail },
    { label: 'Conversion Rate', value: `${conversionRate}%`, icon: TrendingUp },
    { label: 'Pipeline Value', value: `$${(pipelineValue / 1000).toFixed(0)}k`, icon: DollarSign },
  ];

  if (leadsLoading || activitiesLoading || dealsLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground leading-tight">
            {isAdmin ? 'Team Dashboard' : `Welcome back, ${user?.name.split(' ')[0]}`}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAdmin ? 'Overview of all team activity' : 'Your personal performance overview'}
          </p>
        </div>
        <Button
          onClick={() => navigate('/todos')}
          className="hidden md:inline-flex gap-2"
          aria-label="Open To-Do page"
        >
          <ListTodo className="h-4 w-4" />
          To-Do
        </Button>
      </div>

      {/* To-Do widgets */}
      <TodoDashboardWidgets />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center mb-2">
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-semibold text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Lead funnel */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Lead Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={funnelData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                    {funnelData.map((entry) => (
                      <Cell key={entry.name} fill={statusColors[entry.name.toLowerCase()] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-2">
              {funnelData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusColors[d.name.toLowerCase()] }} />
                  <span className="text-muted-foreground">{d.name} ({d.value})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Weekly activity */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Weekly Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[230px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyActivity}>
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="calls" fill="hsl(217.2 91.2% 59.8%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="emails" fill="hsl(217.2 91.2% 75%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Revenue forecast */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Revenue Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[230px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 92%)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v / 1000}k`} />
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Pipeline']} />
                  <Line type="monotone" dataKey="value" stroke="hsl(217.2 91.2% 59.8%)" strokeWidth={2} dot={{ r: 4, fill: 'hsl(217.2 91.2% 59.8%)' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Engagement leaderboard */}
      <EngagementLeaderboard />

      {/* Leaderboard (admin only) */}
      {isAdmin && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Team Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {profiles.filter(p => p.role === 'employee').map((emp) => ({
                name: emp.name,
                calls: activities.filter(a => a.userId === emp.id && a.type === 'call').length,
                emails: activities.filter(a => a.userId === emp.id && a.type === 'email_sent').length,
                leads: leads.filter(l => l.assignedTo === emp.id).length,
              })).map((rep) => (
                <div key={rep.name} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                    {rep.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{rep.name}</p>
                    <p className="text-xs text-muted-foreground">{rep.leads} leads assigned</p>
                  </div>
                  <div className="flex gap-3">
                    <Badge variant="secondary" className="text-xs">{rep.calls} calls</Badge>
                    <Badge variant="secondary" className="text-xs">{rep.emails} emails</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
