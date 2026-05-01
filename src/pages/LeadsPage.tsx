import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeads } from '@/hooks/use-leads';
import { useActivities } from '@/hooks/use-activities';
import { useProfiles } from '@/hooks/use-profiles';
import { useAuth } from '@/contexts/AuthContext';
import { useEngagement } from '@/hooks/use-engagement';
import type { LeadStatus } from '@/types/crm';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { incrementCallCount, incrementEmailCount } from '@/lib/api/leads';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Search, Phone, Mail, Filter, Flame } from 'lucide-react';

const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  cold: { label: 'Cold', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  lukewarm: { label: 'Lukewarm', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  warm: { label: 'Warm', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  dead: { label: 'Dead', className: 'bg-red-100 text-red-700 border-red-200' },
};

export default function LeadsPage() {
  const { leads, isLoading: leadsLoading, updateLead } = useLeads();
  const { addActivity } = useActivities();
  const { profiles } = useProfiles();
  const { user, isAdmin } = useAuth();
  const { topLeads } = useEngagement(100);
  const engagementMap = new Map(topLeads.map(e => [e.leadId, e.score]));
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [industryFilter, setIndustryFilter] = useState<string>('all');
  const [callCountFilter, setCallCountFilter] = useState<Set<string>>(new Set());
  const [emailCountFilter, setEmailCountFilter] = useState<Set<string>>(new Set());
  const [markCallLeadId, setMarkCallLeadId] = useState<string | null>(null);
  const [callNotes, setCallNotes] = useState('');
  const [isLogging, setIsLogging] = useState(false);

  const industries = useMemo(() =>
    [...new Set(leads.map(l => l.industry).filter(Boolean))].sort(),
    [leads]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const COUNT_OPTIONS = ['0', '1', '2', '3', '4', '5+'] as const;

  const toggleCountFilter = (value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const matchesCountFilter = (count: number, filter: Set<string>) => {
    if (filter.size === 0) return true;
    const bucket = count >= 5 ? '5+' : String(count);
    return filter.has(bucket);
  };

  const visibleLeads = useMemo(() => {
    let filtered = leads;
    if (statusFilter !== 'all') filtered = filtered.filter(l => l.status === statusFilter);
    if (industryFilter !== 'all') filtered = filtered.filter(l => l.industry === industryFilter);
    if (callCountFilter.size > 0) filtered = filtered.filter(l => matchesCountFilter(l.callCount ?? 0, callCountFilter));
    if (emailCountFilter.size > 0) filtered = filtered.filter(l => matchesCountFilter(l.emailCount ?? 0, emailCountFilter));
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(l =>
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.company.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [leads, statusFilter, industryFilter, callCountFilter, emailCountFilter, search]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === visibleLeads.length) setSelected(new Set());
    else setSelected(new Set(visibleLeads.map(l => l.id)));
  };

  const bulkUpdateStatus = (status: LeadStatus) => {
    selected.forEach(id => updateLead(id, { status }));
    setSelected(new Set());
  };

  const handleCall = (e: React.MouseEvent, leadId: string, phone: string) => {
    e.stopPropagation();
    addActivity({
      leadId,
      userId: user!.id,
      type: 'call',
      description: `Outbound call initiated`,
      timestamp: new Date().toISOString(),
    });
    updateLead(leadId, { lastContactedAt: new Date().toISOString() });
    incrementCallCount([leadId]);
    // Auto-assign if lead is currently unassigned
    const calledLead = leads.find(l => l.id === leadId);
    if (calledLead && !calledLead.assignedTo) {
      updateLead(leadId, { assignedTo: user!.id });
    }
    window.location.href = `tel:${phone}`;
  };

  const handleEmail = (e: React.MouseEvent, leadId: string, email: string) => {
    e.stopPropagation();
    addActivity({
      leadId,
      userId: user!.id,
      type: 'email_sent',
      description: `Email initiated`,
      timestamp: new Date().toISOString(),
    });
    updateLead(leadId, { lastContactedAt: new Date().toISOString() });
    incrementEmailCount([leadId]);
    window.location.href = `mailto:${email}`;
  };

  const handleMarkCall = async () => {
    if (!markCallLeadId || isLogging) return;
    const leadId = markCallLeadId;
    const notes = callNotes.trim();
    setIsLogging(true);
    try {
      await incrementCallCount([leadId]);
      addActivity({
        leadId,
        userId: user!.id,
        type: 'call',
        description: notes || 'Call logged manually',
        timestamp: new Date().toISOString(),
      });
      updateLead(leadId, { lastContactedAt: new Date().toISOString() });
      // Auto-assign if lead is currently unassigned
      const markedLead = leads.find(l => l.id === leadId);
      if (markedLead && !markedLead.assignedTo) {
        updateLead(leadId, { assignedTo: user!.id });
      }
      setMarkCallLeadId(null);
      setCallNotes('');
    } catch {
      toast.error('Failed to log call. Please try again.');
    } finally {
      setIsLogging(false);
    }
  };

  const getRepName = (id: string) => profiles.find(p => p.id === id)?.name || 'Unassigned';

  const emailStatusBadge = (status?: string) => {
    switch (status) {
      case 'verified':
      case 'likely_to_engage':
        return <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700">Verified</Badge>;
      case 'guessed':
      case 'extrapolated':
        return <Badge variant="secondary" className="text-[10px] bg-amber-50 text-amber-700">Guessed</Badge>;
      case 'invalid':
        return <Badge variant="secondary" className="text-[10px] bg-red-50 text-red-700">Invalid</Badge>;
      case 'unverified':
        return <Badge variant="secondary" className="text-[10px] bg-slate-50 text-slate-500">Unverified</Badge>;
      default:
        return <Badge variant="secondary" className="text-[10px] bg-slate-50 text-slate-500">Unknown</Badge>;
    }
  };

  if (leadsLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">{visibleLeads.length} leads</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
            <SelectItem value="lukewarm">Lukewarm</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="dead">Dead</SelectItem>
          </SelectContent>
        </Select>
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            {industries.map(ind => (
              <SelectItem key={ind} value={ind}>{ind}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              Calls{callCountFilter.size > 0 && ` (${callCountFilter.size})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[160px] p-2" align="start">
            {COUNT_OPTIONS.map(opt => (
              <label key={opt} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded">
                <Checkbox
                  checked={callCountFilter.has(opt)}
                  onCheckedChange={() => toggleCountFilter(opt, setCallCountFilter)}
                />
                {opt === '0' ? 'Never' : opt === '5+' ? '5+ times' : `${opt} time${opt === '1' ? '' : 's'}`}
              </label>
            ))}
            {callCountFilter.size > 0 && (
              <Button variant="ghost" size="sm" className="w-full mt-1 text-xs" onClick={() => setCallCountFilter(new Set())}>
                Clear
              </Button>
            )}
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Emails{emailCountFilter.size > 0 && ` (${emailCountFilter.size})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[160px] p-2" align="start">
            {COUNT_OPTIONS.map(opt => (
              <label key={opt} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded">
                <Checkbox
                  checked={emailCountFilter.has(opt)}
                  onCheckedChange={() => toggleCountFilter(opt, setEmailCountFilter)}
                />
                {opt === '0' ? 'Never' : opt === '5+' ? '5+ times' : `${opt} time${opt === '1' ? '' : 's'}`}
              </label>
            ))}
            {emailCountFilter.size > 0 && (
              <Button variant="ghost" size="sm" className="w-full mt-1 text-xs" onClick={() => setEmailCountFilter(new Set())}>
                Clear
              </Button>
            )}
          </PopoverContent>
        </Popover>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button size="sm" variant="outline" onClick={() => bulkUpdateStatus('warm')}>Mark Warm</Button>
            <Button size="sm" variant="outline" onClick={() => bulkUpdateStatus('dead')}>Mark Dead</Button>
          </div>
        )}
      </div>

      {/* Table */}
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={selected.size === visibleLeads.length && visibleLeads.length > 0} onCheckedChange={toggleAll} /></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Email Status</TableHead>
                <TableHead className="text-xs">Engagement</TableHead>
                <TableHead className="text-xs">Calls</TableHead>
                <TableHead className="text-xs">Emails</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Last Contact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLeads.map(lead => (
                <TableRow key={lead.id} className="cursor-pointer" onClick={() => navigate(`/leads/${lead.id}`)}>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Checkbox checked={selected.has(lead.id)} onCheckedChange={() => toggleSelect(lead.id)} />
                  </TableCell>
                  <TableCell className="font-medium">{lead.firstName} {lead.lastName}</TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm">{lead.company}</p>
                      <p className="text-xs text-muted-foreground">{lead.companySize} emp</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{lead.industry || '—'}</TableCell>
                  <TableCell className="text-sm">{lead.jobTitle}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusConfig[lead.status].className}>
                      {statusConfig[lead.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {lead.phone ? (
                      <button onClick={e => handleCall(e, lead.id, lead.phone)} className="inline-flex items-center gap-1 text-primary hover:underline text-sm">
                        <Phone className="h-3.5 w-3.5" />
                        {lead.phone}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {lead.emailStatus === 'invalid' ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground line-through text-sm cursor-not-allowed truncate max-w-[180px]">
                        <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                        {lead.email}
                      </span>
                    ) : (
                      <button onClick={e => handleEmail(e, lead.id, lead.email)} className="inline-flex items-center gap-1 text-primary hover:underline text-sm truncate max-w-[180px]">
                        <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                        {lead.email}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{emailStatusBadge(lead.emailStatus)}</TableCell>
                  <TableCell className="text-xs">
                    {engagementMap.get(lead.id) ? (
                      <Badge variant="secondary" className="text-[10px] bg-orange-50 text-orange-700 gap-0.5">
                        <Flame className="h-2.5 w-2.5" /> {engagementMap.get(lead.id)}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {(lead.callCount ?? 0) >= 5 ? '5+' : lead.callCount ?? 0}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); setMarkCallLeadId(lead.id); setCallNotes(''); }}
                        className="text-xs text-primary hover:underline whitespace-nowrap"
                      >
                        Mark Call
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{(lead.emailCount ?? 0) >= 5 ? '5+' : lead.emailCount ?? 0}</TableCell>
                  <TableCell className="text-sm" onClick={e => e.stopPropagation()}>
                    {lead.assignedTo ? (
                      <span className="text-muted-foreground">{getRepName(lead.assignedTo)}</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2"
                        onClick={() => updateLead(lead.id, { assignedTo: user!.id })}
                      >
                        Claim
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString() : 'Never'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={markCallLeadId !== null} onOpenChange={open => { if (!open) { setMarkCallLeadId(null); setCallNotes(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Call</DialogTitle>
            <DialogDescription>Add notes for this call (optional).</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Call notes..."
            value={callNotes}
            onChange={e => setCallNotes(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMarkCallLeadId(null); setCallNotes(''); }}>
              Cancel
            </Button>
            <Button onClick={handleMarkCall} disabled={isLogging}>
              {isLogging ? 'Logging...' : 'Log Call'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
