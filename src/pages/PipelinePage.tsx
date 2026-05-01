import { useAuth } from '@/contexts/AuthContext';
import { useDeals } from '@/hooks/use-deals';
import { useLeads } from '@/hooks/use-leads';
import { useProfiles } from '@/hooks/use-profiles';
import type { DealStage, Deal } from '@/types/crm';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

const stages: { key: DealStage; label: string; color: string }[] = [
  { key: 'new', label: 'New', color: 'bg-slate-100' },
  { key: 'contacted', label: 'Contacted', color: 'bg-blue-50' },
  { key: 'qualified', label: 'Qualified', color: 'bg-amber-50' },
  { key: 'proposal', label: 'Proposal', color: 'bg-orange-50' },
  { key: 'negotiation', label: 'Negotiation', color: 'bg-purple-50' },
  { key: 'closed_won', label: 'Closed Won', color: 'bg-emerald-50' },
  { key: 'closed_lost', label: 'Closed Lost', color: 'bg-red-50' },
];

export default function PipelinePage() {
  const { deals, updateDeal, createDeal, isLoading: dealsLoading } = useDeals();
  const { leads } = useLeads();
  const { profiles } = useProfiles();
  const { isAdmin, user } = useAuth();
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [dealLeadId, setDealLeadId] = useState('');
  const [dealStage, setDealStage] = useState<string>('new');
  const [dealSearch, setDealSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const totalPipeline = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage)).reduce((s, d) => s + d.value, 0);

  const handleDragStart = (dealId: string) => setDraggedDeal(dealId);
  const handleDragEnd = () => setDraggedDeal(null);
  const handleDrop = (stage: DealStage) => {
    if (draggedDeal) {
      updateDeal(draggedDeal, { stage });
      setDraggedDeal(null);
    }
  };

  const getLeadName = (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    return lead ? `${lead.firstName} ${lead.lastName}` : 'Unknown';
  };

  const handleCreateDeal = async () => {
    if (!dealTitle.trim() || !dealLeadId || !user) return;
    setCreating(true);
    try {
      createDeal({
        leadId: dealLeadId,
        title: dealTitle.trim(),
        value: parseFloat(dealValue) || 0,
        stage: dealStage as Deal['stage'],
        assignedTo: user.id,
      });
      setShowNewDeal(false);
      setDealTitle('');
      setDealValue('');
      setDealLeadId('');
      setDealStage('new');
      setDealSearch('');
      toast.success('Deal created');
    } catch {
      toast.error('Failed to create deal');
    } finally {
      setCreating(false);
    }
  };

  const filteredDealLeads = leads.filter(l => {
    if (!dealSearch) return false;
    const q = dealSearch.toLowerCase();
    return (
      l.firstName.toLowerCase().includes(q) ||
      l.lastName.toLowerCase().includes(q) ||
      l.company.toLowerCase().includes(q)
    );
  });

  if (dealsLoading) {
    return <div className="p-6 flex items-center justify-center min-h-[50vh]"><div className="text-sm text-muted-foreground">Loading...</div></div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground">{deals.length} deals · ${totalPipeline.toLocaleString()} active pipeline</p>
        </div>
        <Button onClick={() => setShowNewDeal(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> New Deal
        </Button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map(stage => {
          const stageDeals = deals.filter(d => d.stage === stage.key);
          const stageTotal = stageDeals.reduce((s, d) => s + d.value, 0);
          return (
            <div
              key={stage.key}
              className="flex-shrink-0 w-[240px]"
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(stage.key)}
            >
              <div className={`rounded-lg ${stage.color} p-3 min-h-[400px]`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">{stage.label}</h3>
                  <Badge variant="secondary" className="text-[10px]">{stageDeals.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">${stageTotal.toLocaleString()}</p>
                <div className="space-y-2">
                  {stageDeals.map(deal => (
                    <Card
                      key={deal.id}
                      className="border shadow-sm cursor-grab active:cursor-grabbing bg-background"
                      draggable
                      onDragStart={() => handleDragStart(deal.id)}
                      onDragEnd={handleDragEnd}
                    >
                      <CardContent className="p-3">
                        <p className="text-sm font-medium text-foreground leading-tight">{deal.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{getLeadName(deal.leadId)}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-sm font-semibold text-primary flex items-center gap-0.5">
                            <DollarSign className="h-3.5 w-3.5" />{deal.value.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {isAdmin ? profiles.find(p => p.id === deal.assignedTo)?.name?.split(' ')[0] : ''}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={showNewDeal} onOpenChange={setShowNewDeal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Deal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Lead</Label>
              <div className="relative">
                <Input
                  placeholder="Search for a lead..."
                  value={dealLeadId ? `${leads.find(l => l.id === dealLeadId)?.firstName} ${leads.find(l => l.id === dealLeadId)?.lastName}` : dealSearch}
                  onChange={e => { setDealSearch(e.target.value); setDealLeadId(''); }}
                  onFocus={() => { if (dealLeadId) { setDealSearch(''); setDealLeadId(''); } }}
                />
                {!dealLeadId && dealSearch && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-background border rounded-md shadow-lg max-h-[200px] overflow-y-auto">
                    {filteredDealLeads.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No leads found</div>
                    ) : (
                      filteredDealLeads.slice(0, 10).map(l => (
                        <div key={l.id} className="px-3 py-2 text-sm cursor-pointer hover:bg-accent transition-colors" onClick={() => { setDealLeadId(l.id); setDealSearch(''); }}>
                          <span className="font-medium">{l.firstName} {l.lastName}</span>
                          <span className="text-muted-foreground"> — {l.company}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input placeholder="e.g., Enterprise API License" value={dealTitle} onChange={e => setDealTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Value ($)</Label>
              <Input type="number" placeholder="0" value={dealValue} onChange={e => setDealValue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Stage</Label>
              <Select value={dealStage} onValueChange={setDealStage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="proposal">Proposal</SelectItem>
                  <SelectItem value="negotiation">Negotiation</SelectItem>
                  <SelectItem value="closed_won">Closed Won</SelectItem>
                  <SelectItem value="closed_lost">Closed Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDeal(false)}>Cancel</Button>
            <Button onClick={handleCreateDeal} disabled={creating || !dealTitle.trim() || !dealLeadId}>
              {creating ? 'Creating...' : 'Create Deal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
