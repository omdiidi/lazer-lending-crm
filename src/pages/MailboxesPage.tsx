import { useState, useMemo } from 'react';
import { useMailboxes } from '@/hooks/use-mailboxes';
import { useDomains } from '@/hooks/use-domains';
import { useSendingPools } from '@/hooks/use-sending-pools';
import type { Mailbox, MailboxWarmupState, PausedReason } from '@/types/lazer';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Mailbox as MailboxIcon } from 'lucide-react';

// Warmup state colors follow project convention
const warmupConfig: Record<MailboxWarmupState, { label: string; className: string }> = {
  provisioning:      { label: 'Provisioning',      className: 'bg-blue-100 text-blue-700 border-blue-200' },
  connection_pending: { label: 'Connection Pending', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  warming:           { label: 'Warming',            className: 'bg-amber-100 text-amber-700 border-amber-200' },
  live:              { label: 'Live',               className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  paused:            { label: 'Paused',             className: 'bg-orange-100 text-orange-700 border-orange-200' },
  failed:            { label: 'Failed',             className: 'bg-red-100 text-red-700 border-red-200' },
};

const connectionConfig: Record<string, { label: string; dot: string }> = {
  connected:            { label: 'Connected',    dot: 'bg-emerald-500' },
  disconnected:         { label: 'Disconnected', dot: 'bg-red-500' },
  app_password_invalid: { label: 'Auth Error',   dot: 'bg-red-500' },
};

type FilterTab = 'all' | 'live' | 'paused' | 'warming';

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'live',    label: 'Live' },
  { key: 'paused',  label: 'Paused' },
  { key: 'warming', label: 'Warming' },
];

const PAUSE_REASONS: { value: PausedReason; label: string }[] = [
  { value: 'manual',                   label: 'Manual pause' },
  { value: 'bounce_threshold',         label: 'Bounce threshold' },
  { value: 'complaint_threshold',      label: 'Complaint threshold' },
  { value: 'single_complaint_review',  label: 'Complaint — manual review' },
  { value: 'dns_failure',              label: 'DNS failure' },
  { value: 'app_password_invalid',     label: 'App password invalid' },
  { value: 'connection_lost',          label: 'Connection lost' },
  { value: 'smartlead_rate_limit',     label: 'Smartlead rate limit' },
];

function RateBadge({ rate, threshold }: { rate: number | null | undefined; threshold: number }) {
  // Treat null/undefined/non-finite as "no data yet" — fresh mailboxes have
  // no traffic until the watchdog populates last_24h_*_rate.
  const numRate = typeof rate === 'string' ? parseFloat(rate) : rate;
  if (numRate == null || !Number.isFinite(numRate)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const pct = (numRate * 100).toFixed(2);
  const over = numRate > threshold;
  return (
    <Badge
      variant="outline"
      className={over
        ? 'bg-red-100 text-red-700 border-red-200 text-[10px]'
        : 'bg-muted text-muted-foreground text-[10px]'}
    >
      {pct}%
    </Badge>
  );
}

export default function MailboxesPage() {
  const { mailboxes, isLoading, pauseMailbox, isPausing, resumeMailbox, isResuming, createMailbox, isCreating } = useMailboxes();
  const { domains } = useDomains();
  const { pools } = useSendingPools();

  const [filter, setFilter] = useState<FilterTab>('all');
  const [pauseTarget, setPauseTarget] = useState<Mailbox | null>(null);
  const [pauseReason, setPauseReason] = useState<PausedReason>('manual');
  const [addOpen, setAddOpen] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newDomainId, setNewDomainId] = useState<string>('');
  const [newPoolId, setNewPoolId] = useState<string>('');
  const [newDailyCap, setNewDailyCap] = useState(10);

  const visible = useMemo(() => {
    switch (filter) {
      case 'live':    return mailboxes.filter(m => m.warmupState === 'live');
      case 'paused':  return mailboxes.filter(m => m.warmupState === 'paused');
      case 'warming': return mailboxes.filter(m => m.warmupState === 'warming');
      default:        return mailboxes;
    }
  }, [mailboxes, filter]);

  const handlePause = async () => {
    if (!pauseTarget) return;
    try {
      pauseMailbox(pauseTarget.id, pauseReason);
      toast.success(`${pauseTarget.address} paused`);
      setPauseTarget(null);
    } catch {
      toast.error('Failed to pause mailbox');
    }
  };

  const handleResume = (mailbox: Mailbox) => {
    resumeMailbox(mailbox.id);
    toast.success(`${mailbox.address} resuming`);
  };

  const handleCreate = async () => {
    if (!newAddress.trim() || !newDomainId) return;
    try {
      await createMailbox({
        address: newAddress.trim(),
        domainId: newDomainId,
        poolId: newPoolId || null,
        dailyCap: newDailyCap,
      });
      toast.success(`${newAddress} added`);
      setAddOpen(false);
      setNewAddress('');
      setNewDomainId('');
      setNewPoolId('');
      setNewDailyCap(10);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add mailbox');
    }
  };

  // Today sent: show "0" not "—" for active mailboxes; show "—" for non-live ones
  const formatCount = (count: number, state: MailboxWarmupState) => {
    if (state === 'live' || state === 'warming') return count;
    return count > 0 ? count : '—';
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <MailboxIcon className="h-5 w-5" /> Mailboxes
          </h1>
          <p className="text-sm text-muted-foreground">
            {visible.length} mailbox{visible.length !== 1 ? 'es' : ''}
            {' '}· Realtime updates enabled
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={domains.length === 0}>
          Add Mailbox
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {filterTabs.map(tab => (
          <Button
            key={tab.key}
            variant={filter === tab.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Warmup State</TableHead>
                <TableHead className="text-xs">Enrolled</TableHead>
                <TableHead className="text-xs">Sent</TableHead>
                <TableHead className="text-xs">Cap</TableHead>
                <TableHead className="text-xs">Bounce 24h</TableHead>
                <TableHead className="text-xs">Complaint 24h</TableHead>
                <TableHead>Paused Reason</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                    No mailboxes yet. Provision a domain first, then add mailboxes via Zapmail.
                  </TableCell>
                </TableRow>
              )}
              {visible.map(mb => {
                const conn = connectionConfig[mb.connectionStatus] ?? { label: mb.connectionStatus, dot: 'bg-gray-400' };
                const warmup = warmupConfig[mb.warmupState];
                return (
                  <TableRow key={mb.id}>
                    <TableCell className="font-mono text-sm font-medium">
                      {mb.address}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {mb.domain?.hostname ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${conn.dot}`} />
                        <span className="text-xs text-muted-foreground">{conn.label}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={warmup.className}>
                        {warmup.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatCount(mb.todayEnrolledCount, mb.warmupState)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatCount(mb.todaySentCount, mb.warmupState)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {mb.dailyCap}
                    </TableCell>
                    <TableCell>
                      <RateBadge rate={mb.last24hBounceRate} threshold={0.02} />
                    </TableCell>
                    <TableCell>
                      <RateBadge rate={mb.last24hComplaintRate} threshold={0.001} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground capitalize">
                      {mb.pausedReason?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {mb.warmupState !== 'paused' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => { setPauseTarget(mb); setPauseReason('manual'); }}
                            disabled={isPausing}
                          >
                            Pause
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 text-emerald-700"
                            onClick={() => handleResume(mb)}
                            disabled={isResuming}
                          >
                            Resume
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pause Dialog */}
      <Dialog
        open={!!pauseTarget}
        onOpenChange={open => { if (!open) setPauseTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause {pauseTarget?.address}</DialogTitle>
            <DialogDescription>
              Select a reason for the pause. The mailbox will not receive new send assignments
              until resumed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select
              value={pauseReason}
              onValueChange={v => setPauseReason(v as PausedReason)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAUSE_REASONS.map(r => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseTarget(null)}>Cancel</Button>
            <Button
              onClick={handlePause}
              disabled={isPausing}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {isPausing ? 'Pausing...' : 'Pause Mailbox'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Mailbox Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Mailbox</DialogTitle>
            <DialogDescription>
              Manually register a Workspace mailbox. Once Smartlead-connected, paste the
              account_id via the row's edit menu. State machine starts at provisioning.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="mb-address">Address</Label>
              <Input
                id="mb-address"
                placeholder="omid@lazer-loans.com"
                value={newAddress}
                onChange={e => setNewAddress(e.target.value)}
              />
            </div>
            <div>
              <Label>Domain</Label>
              <Select value={newDomainId} onValueChange={setNewDomainId}>
                <SelectTrigger><SelectValue placeholder="Pick a domain" /></SelectTrigger>
                <SelectContent>
                  {domains.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.hostname}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Sending Pool (optional)</Label>
              <Select value={newPoolId} onValueChange={setNewPoolId}>
                <SelectTrigger><SelectValue placeholder="No pool" /></SelectTrigger>
                <SelectContent>
                  {pools.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mb-cap">Daily cap (10–60)</Label>
              <Input
                id="mb-cap"
                type="number"
                min={10}
                max={60}
                value={newDailyCap}
                onChange={e => setNewDailyCap(parseInt(e.target.value || '10', 10))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Fresh mailboxes start at 10 (week-1 ramp); raise after 7 days clean DKIM.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={isCreating || !newAddress.trim() || !newDomainId}
            >
              {isCreating ? 'Adding...' : 'Add Mailbox'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
