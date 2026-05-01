import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLeads } from '@/hooks/use-leads';
import { useActivities } from '@/hooks/use-activities';
import { useProfiles } from '@/hooks/use-profiles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Phone, Mail, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import LeadAssignmentChat from '@/components/staff/LeadAssignmentChat';

type Period = 'day' | 'week' | 'month';

function getPeriodStart(period: Period): Date {
  const now = new Date();
  if (period === 'day') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(now);
  d.setDate(d.getDate() - (period === 'week' ? 7 : 30));
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function StaffPerformancePage() {
  const { leads, isLoading: leadsLoading } = useLeads();
  const { activities, isLoading: activitiesLoading } = useActivities();
  const { profiles, isLoading: profilesLoading } = useProfiles();
  const [period, setPeriod] = useState<Period>('week');
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const queryClient = useQueryClient();

  const employeeStats = useMemo(() => {
    const periodStart = getPeriodStart(period);
    return profiles.map(profile => {
      const periodActivities = activities.filter(
        a => a.userId === profile.id && new Date(a.timestamp) >= periodStart
      );
      const calls = periodActivities.filter(a => a.type === 'call').length;
      const emails = periodActivities.filter(a => a.type === 'email_sent').length;

      const assignedLeads = leads.filter(l => l.assignedTo === profile.id);
      const warmLeads = assignedLeads.filter(l => l.status === 'warm').length;
      const conversionRate = assignedLeads.length > 0
        ? Math.round((warmLeads / assignedLeads.length) * 100)
        : 0;

      const allUserActivities = activities.filter(a => a.userId === profile.id);
      const lastActive = allUserActivities.length > 0
        ? allUserActivities.reduce((latest, a) =>
            a.timestamp > latest ? a.timestamp : latest,
            allUserActivities[0].timestamp
          )
        : null;

      return {
        id: profile.id,
        name: profile.name,
        calls,
        emails,
        conversionRate,
        leadsAssigned: assignedLeads.length,
        lastActive,
      };
    });
  }, [profiles, activities, leads, period]);

  const teamTotals = useMemo(() => {
    const periodStart = getPeriodStart(period);
    return {
      calls: employeeStats.reduce((s, e) => s + e.calls, 0),
      emails: employeeStats.reduce((s, e) => s + e.emails, 0),
      warmLeads: leads.filter(
        l => l.status === 'warm' && new Date(l.createdAt) >= periodStart
      ).length,
    };
  }, [employeeStats, leads, period]);

  const chartData = useMemo(() =>
    employeeStats.map(e => ({
      name: e.name.split(' ')[0],
      calls: e.calls,
      emails: e.emails,
      conversionRate: e.conversionRate,
    })),
  [employeeStats]);

  const unassignedCount = useMemo(() => leads.filter(l => !l.assignedTo).length, [leads]);

  const handleRunCleanup = async () => {
    setCleanupRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-lead-assignments');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Cleanup complete — ${data.unassigned} leads returned to unassigned pool`);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    } catch {
      toast.error('Cleanup failed');
    } finally {
      setCleanupRunning(false);
    }
  };

  if (leadsLoading || activitiesLoading || profilesLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Staff Performance</h1>
          <p className="text-sm text-muted-foreground">{profiles.length} team members</p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-md p-1">
          {(['day', 'week', 'month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1 text-sm rounded-md transition-colors capitalize',
                period === p
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Lead Assignment */}
      <Card className="border shadow-sm">
        <CardContent className="p-4">
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-medium mb-3">Lead Assignment</h2>
              <LeadAssignmentChat leads={leads} profiles={profiles} />
            </div>
            <div className="flex flex-col gap-4 w-48 shrink-0">
              <div>
                <p className="text-2xl font-bold">{unassignedCount}</p>
                <p className="text-sm text-muted-foreground">Unassigned leads</p>
              </div>
              <Button
                variant="outline"
                onClick={handleRunCleanup}
                disabled={cleanupRunning}
                className="w-full"
              >
                {cleanupRunning ? 'Running...' : 'Run Cleanup'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Returns all non-warm leads to the unassigned pool. Runs automatically at 2am UTC.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center mb-2"><Phone className="h-4 w-4 text-muted-foreground" /></div>
            <p className="text-2xl font-semibold text-foreground">{teamTotals.calls}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Calls Made</p>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center mb-2"><Mail className="h-4 w-4 text-muted-foreground" /></div>
            <p className="text-2xl font-semibold text-foreground">{teamTotals.emails}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Emails Sent</p>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center mb-2"><TrendingUp className="h-4 w-4 text-muted-foreground" /></div>
            <p className="text-2xl font-semibold text-foreground">{teamTotals.warmLeads}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Warm Leads</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Team Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Calls</TableHead>
                <TableHead>Emails</TableHead>
                <TableHead>Conversion Rate</TableHead>
                <TableHead>Leads Assigned</TableHead>
                <TableHead>Last Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employeeStats.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>{e.calls}</TableCell>
                  <TableCell>{e.emails}</TableCell>
                  <TableCell>{e.conversionRate}%</TableCell>
                  <TableCell>{e.leadsAssigned}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {e.lastActive ? new Date(e.lastActive).toLocaleDateString() : 'Never'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Calls by Employee</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="calls" fill="hsl(217.2 91.2% 59.8%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Emails by Employee</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="emails" fill="hsl(38 92% 50%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate by Employee</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'Conversion Rate']} />
                  <Bar dataKey="conversionRate" fill="hsl(25 95% 53%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
