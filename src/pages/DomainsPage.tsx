import { useState, useMemo } from 'react';
import { useDomains } from '@/hooks/use-domains';
import type { Domain, DomainStatus, CreateDomainPayload } from '@/types/lazer';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Globe, Plus } from 'lucide-react';

// Status colors follow project convention:
// blue = provisioning/dns_pending, amber = verifying, emerald = ready,
// orange = cooldown, red = failed/retired
const statusConfig: Record<DomainStatus, { label: string; className: string }> = {
  provisioning: { label: 'Provisioning', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  dns_pending:  { label: 'DNS Pending',  className: 'bg-blue-100 text-blue-700 border-blue-200' },
  verifying:    { label: 'Verifying',    className: 'bg-amber-100 text-amber-700 border-amber-200' },
  ready:        { label: 'Ready',        className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  cooldown:     { label: 'Cooldown',     className: 'bg-orange-100 text-orange-700 border-orange-200' },
  retired:      { label: 'Retired',      className: 'bg-red-100 text-red-700 border-red-200' },
  failed:       { label: 'Failed',       className: 'bg-red-100 text-red-700 border-red-200' },
};

type FilterTab = 'all' | 'ready' | 'cooldown' | 'retired';

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'ready',    label: 'Ready' },
  { key: 'cooldown', label: 'Cooldown' },
  { key: 'retired',  label: 'Retired' },
];

function DnsIndicator({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      title={`${label}: ${ok ? 'verified' : 'not verified'}`}
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-400'}`}
    />
  );
}

export default function DomainsPage() {
  const { domains, isLoading, createDomainAsync, isCreating, retireDomain, isRetiring } = useDomains();

  const [filter, setFilter] = useState<FilterTab>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [retireTarget, setRetireTarget] = useState<Domain | null>(null);

  // Add domain form state
  const [hostname, setHostname] = useState('');
  const [ownerEntity, setOwnerEntity] = useState('');
  const [registrar, setRegistrar] = useState('');

  const visible = useMemo(() => {
    if (filter === 'all') return domains;
    if (filter === 'ready') return domains.filter(d => d.status === 'ready');
    if (filter === 'cooldown') return domains.filter(d => d.status === 'cooldown');
    if (filter === 'retired') return domains.filter(d => d.status === 'retired');
    return domains;
  }, [domains, filter]);

  const handleAddDomain = async () => {
    if (!hostname.trim()) return;
    const payload: CreateDomainPayload = {
      hostname: hostname.trim().toLowerCase(),
      provider: 'zapmail',
      ownerEntity: ownerEntity.trim() || undefined,
      registrar: registrar.trim() || undefined,
    };
    try {
      await createDomainAsync(payload);
      toast.success(`Domain ${payload.hostname} provisioning started`);
      resetAddDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to provision domain');
    }
  };

  const handleRetire = async () => {
    if (!retireTarget) return;
    try {
      retireDomain(retireTarget.id);
      toast.success(`${retireTarget.hostname} moved to cooldown`);
      setRetireTarget(null);
    } catch {
      toast.error('Failed to retire domain');
    }
  };

  const resetAddDialog = () => {
    setShowAddDialog(false);
    setHostname('');
    setOwnerEntity('');
    setRegistrar('');
  };

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : '—';

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Globe className="h-5 w-5" /> Domains
          </h1>
          <p className="text-sm text-muted-foreground">
            {visible.length} domain{visible.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add Domain
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
                <TableHead>Hostname</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>DNS</TableHead>
                <TableHead>DMARC Policy</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Cooldown Until</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No domains yet. Click "Add Domain" to provision your first burner domain.
                  </TableCell>
                </TableRow>
              )}
              {visible.map(domain => (
                <TableRow key={domain.id}>
                  <TableCell className="font-mono text-sm font-medium">
                    {domain.hostname}
                  </TableCell>
                  <TableCell className="text-sm capitalize text-muted-foreground">
                    {domain.provider}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusConfig[domain.status].className}
                    >
                      {statusConfig[domain.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5" title="DKIM / SPF / DMARC">
                      <DnsIndicator ok={domain.dkimVerified} label="DKIM" />
                      <DnsIndicator ok={domain.spfVerified} label="SPF" />
                      <DnsIndicator ok={domain.dmarcVerified} label="DMARC" />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground uppercase">
                    {domain.dmarcPolicy ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(domain.registeredAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(domain.cooldownUntil)}
                  </TableCell>
                  <TableCell>
                    {domain.status !== 'cooldown' && domain.status !== 'retired' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive text-xs"
                        onClick={() => setRetireTarget(domain)}
                        disabled={isRetiring}
                      >
                        Retire
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Domain Dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={open => { if (!open) resetAddDialog(); else setShowAddDialog(true); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Burner Domain</DialogTitle>
            <DialogDescription>
              Provisions a new domain via Zapmail. DNS records (SPF, DKIM, DMARC) will be
              configured automatically. The domain will start warming up after verification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Hostname</Label>
              <Input
                placeholder="e.g., lazer-loans.com"
                value={hostname}
                onChange={e => setHostname(e.target.value.toLowerCase().trim())}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Use a Lazer-affiliated domain name. Never use lazerlending.com.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Owner Entity (optional)</Label>
              <Input
                placeholder="e.g., IntegrateAPI LLC"
                value={ownerEntity}
                onChange={e => setOwnerEntity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Registrar (optional)</Label>
              <Input
                placeholder="e.g., Namecheap"
                value={registrar}
                onChange={e => setRegistrar(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetAddDialog}>Cancel</Button>
            <Button
              onClick={handleAddDomain}
              disabled={isCreating || !hostname.trim()}
            >
              {isCreating ? 'Provisioning...' : 'Provision Domain'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Retire confirmation */}
      <AlertDialog
        open={!!retireTarget}
        onOpenChange={open => { if (!open) setRetireTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire {retireTarget?.hostname}?</AlertDialogTitle>
            <AlertDialogDescription>
              This moves the domain into a 30-day cooldown. All attached mailboxes will stop
              receiving new send assignments. Existing replies will still be accepted during
              the cooldown window. This cannot be undone via the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRetire}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Retire Domain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
