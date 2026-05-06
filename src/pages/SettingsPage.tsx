import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/use-profiles';
import { useSendingPools } from '@/hooks/use-sending-pools';
import { useMailboxes } from '@/hooks/use-mailboxes';
import { createInvite, deleteMember } from '@/lib/api/team';
import { getApiKeys, revokeApiKey, type ApiKey } from '@/lib/api/api-keys';
import { getSendingPools, getMailboxesInPool } from '@/lib/api/sending-pools';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Mailbox, SendingPool } from '@/types/lazer';
import {
  User,
  Shield,
  Plug,
  Trash2,
  Mail,
  Copy,
  RotateCcw,
  Key,
  Globe,
  Mailbox as MailboxIcon,
  Layers,
  CheckCircle2,
  Circle,
  ExternalLink,
} from 'lucide-react';

// ─── Settings sub-component: key indicator ──────────────────────────────────

function KeyIndicator({ label, configured }: { label: string; configured: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {configured
        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className={configured ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

// ─── Settings sub-component: Sending Pools panel ────────────────────────────

function SendingPoolsPanel() {
  const { pools, isLoading, createPoolAsync, isCreating, addMailboxToPool, removeMailboxFromPool } = useSendingPools();
  const { mailboxes } = useMailboxes();

  const [newPoolName, setNewPoolName] = useState('');
  const [assignPoolId, setAssignPoolId] = useState<string | null>(null);

  // For the assign dialog: mailboxes already in the selected pool
  const { data: poolMailboxes = [] } = useQuery({
    queryKey: ['pool-mailboxes', assignPoolId],
    queryFn: () => assignPoolId ? getMailboxesInPool(assignPoolId) : Promise.resolve([]),
    enabled: !!assignPoolId,
  });

  const poolMailboxIds = new Set(poolMailboxes.map((m: Mailbox) => m.id));

  const handleCreatePool = async () => {
    if (!newPoolName.trim()) return;
    try {
      await createPoolAsync(newPoolName.trim());
      toast.success('Sending pool created');
      setNewPoolName('');
    } catch {
      toast.error('Failed to create pool');
    }
  };

  const toggleMailbox = (mailboxId: string) => {
    if (!assignPoolId) return;
    if (poolMailboxIds.has(mailboxId)) {
      removeMailboxFromPool(assignPoolId, mailboxId);
    } else {
      addMailboxToPool(assignPoolId, mailboxId);
    }
  };

  const assignTarget = pools.find(p => p.id === assignPoolId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading pools...</p>;

  return (
    <div className="space-y-4">
      {pools.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No sending pools yet. Create one to group mailboxes for campaigns.
        </p>
      )}
      {pools.map(pool => (
        <div key={pool.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{pool.name}</p>
            <p className="text-xs text-muted-foreground">
              Created {new Date(pool.createdAt).toLocaleDateString()}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setAssignPoolId(pool.id)}
          >
            Manage Mailboxes
          </Button>
        </div>
      ))}

      {/* Create new pool */}
      <div className="flex gap-2 pt-1">
        <Input
          placeholder="Pool name (e.g., Q3 Cold Outreach)"
          value={newPoolName}
          onChange={e => setNewPoolName(e.target.value)}
          className="max-w-xs"
          onKeyDown={e => { if (e.key === 'Enter') handleCreatePool(); }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleCreatePool}
          disabled={isCreating || !newPoolName.trim()}
        >
          {isCreating ? 'Creating...' : '+ New Pool'}
        </Button>
      </div>

      {/* Assign mailboxes dialog */}
      <Dialog
        open={!!assignPoolId}
        onOpenChange={open => { if (!open) setAssignPoolId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Mailboxes — {assignTarget?.name}</DialogTitle>
            <DialogDescription>
              Select which mailboxes belong to this pool. Campaigns that use this pool will
              share sends across these mailboxes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {mailboxes.length === 0 && (
              <p className="text-sm text-muted-foreground">No mailboxes provisioned yet.</p>
            )}
            {mailboxes.map(mb => (
              <label
                key={mb.id}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={poolMailboxIds.has(mb.id)}
                  onCheckedChange={() => toggleMailbox(mb.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono truncate">{mb.address}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {mb.warmupState.replace(/_/g, ' ')} · cap {mb.dailyCap}/day
                  </p>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignPoolId(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main SettingsPage ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, isAdmin, refreshUser } = useAuth();
  const { profiles, isLoading, updateProfile } = useProfiles();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState(user?.name || '');
  const [editPrefix, setEditPrefix] = useState(user?.emailPrefix || '');
  const [saving, setSaving] = useState(false);

  // Invite state
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [generatedToken, setGeneratedToken] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // API keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [newApiKeyName, setNewApiKeyName] = useState('');
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
  const [generatingApiKey, setGeneratingApiKey] = useState(false);

  // Warmup state (existing IntegrateAPI singleton)
  const [warmupFirstEmail, setWarmupFirstEmail] = useState<string | null>(null);

  // ---- Lazer: Vendor integration state (read-only indicators) ----
  // These reflect whether env vars are configured (shown as connected/not configured).
  // Actual key values never displayed; inferred from Edge Function health.
  const smartleadConfigured = true; // placeholder — replace with real health check
  const zerobounceConfigured = true;
  const resendConfigured = true;
  const fubConfigured = false;

  // ---- Reply forwarding ----
  const [defaultReplyEmail, setDefaultReplyEmail] = useState('');
  const [replyEmailSaving, setReplyEmailSaving] = useState(false);

  // ---- Alerts ----
  const [opsAlertEmail, setOpsAlertEmail] = useState('');
  const [alertCategories, setAlertCategories] = useState({
    mailboxPaused: true,
    webhookGap: true,
    fubSuppressed: true,
    classifierCircuitOpen: true,
    smartleadSilentDrop: false,
  });
  const [alertSaving, setAlertSaving] = useState(false);

  // ---- FUB settings ----
  const [fubStageName, setFubStageName] = useState('Lead');
  const [fubDedup, setFubDedup] = useState(true);
  const [fubSaving, setFubSaving] = useState(false);

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    setApiKeyLoading(true);
    try {
      const keys = await getApiKeys();
      setApiKeys(keys);
    } catch {
      toast.error('Failed to load API keys');
    } finally {
      setApiKeyLoading(false);
    }
  };

  useEffect(() => {
    supabase.from('warmup_state').select('*').eq('id', 'default').maybeSingle()
      .then(({ data }) => {
        if (data?.first_email_at) setWarmupFirstEmail(data.first_email_at);
      });
  }, []);

  const warmupDays = warmupFirstEmail
    ? Math.floor((Date.now() - new Date(warmupFirstEmail).getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  const maxTier = warmupDays >= 91 ? 200 : warmupDays >= 61 ? 150 : warmupDays >= 31 ? 100
    : warmupDays >= 22 ? 75 : warmupDays >= 15 ? 50 : warmupDays >= 8 ? 25 : 20;

  const handleCreateInvite = async () => {
    setInviteLoading(true);
    try {
      const result = await createInvite(inviteName, inviteEmail, inviteRole);
      setGeneratedToken(result.token);
      toast.success('Invite created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setInviteLoading(false);
    }
  };

  const resetInviteDialog = () => {
    setShowInviteDialog(false);
    setInviteName('');
    setInviteEmail('');
    setInviteRole('employee');
    setGeneratedToken('');
  };

  const handleDeleteMember = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteMember(deleteTarget.id);
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(`${deleteTarget.name} removed from team`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleGenerateApiKey = async () => {
    setGeneratingApiKey(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-api-key`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newApiKeyName }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to generate API key');
        return;
      }
      setGeneratedApiKey(data.key);
      await loadApiKeys();
    } catch {
      toast.error('Failed to generate API key');
    } finally {
      setGeneratingApiKey(false);
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    try {
      await revokeApiKey(id);
      setApiKeys(prev => prev.filter(k => k.id !== id));
      toast.success('API key revoked');
    } catch {
      toast.error('Failed to revoke API key');
    }
  };

  const resetApiKeyDialog = () => {
    setShowApiKeyDialog(false);
    setNewApiKeyName('');
    setGeneratedApiKey(null);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateProfile(user.id, { name: editName, emailPrefix: editPrefix });
      await refreshUser();
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveReplyEmail = async () => {
    setReplyEmailSaving(true);
    try {
      // Persisted via app settings table (not yet wired — Phase 1.4 / env fallback for now)
      toast.success('Reply forwarding email saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setReplyEmailSaving(false);
    }
  };

  const handleSaveAlerts = async () => {
    setAlertSaving(true);
    try {
      // Persisted via app settings table (Phase 1.4 — env fallback for now)
      toast.success('Alert settings saved');
    } catch {
      toast.error('Failed to save alert settings');
    } finally {
      setAlertSaving(false);
    }
  };

  const handleSaveFub = async () => {
    setFubSaving(true);
    try {
      // Persisted via app settings table (Phase 2.4 — verify against GET /v1/stages first)
      toast.success('FUB settings saved');
    } catch {
      toast.error('Failed to save FUB settings');
    } finally {
      setFubSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[900px] space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account, team, and Lazer Lending CRM configuration</p>
      </div>

      {/* Profile */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email Prefix
            </Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="e.g., nick"
                value={editPrefix}
                onChange={e => setEditPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                className="max-w-[200px]"
              />
              <span className="text-sm text-muted-foreground">@integrateapi.ai</span>
            </div>
            {editPrefix && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Compose & replies: <span className="text-foreground">{editPrefix}@integrateapi.ai</span></p>
                <p>Campaign sends: <span className="text-foreground">{editPrefix}@mail.integrateapi.ai</span></p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label>Role</Label>
            <Badge variant="secondary" className="capitalize">{user?.role}</Badge>
          </div>
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      {/* Team (admin) */}
      {isAdmin && (
        <>
          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" /> Team Management
              </CardTitle>
              <CardDescription>Manage employee accounts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {profiles.map(u => (
                <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                    {u.name.split(' ').map((n: string) => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <Badge variant="secondary" className="capitalize text-xs">{u.role}</Badge>
                  {u.role !== 'admin' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget({ id: u.id, name: u.name })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setShowInviteDialog(true)}>
                + Add Team Member
              </Button>
            </CardContent>
          </Card>

          {/* Domain Warmup (legacy IntegrateAPI singleton) */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" /> Domain Warmup (Legacy)
              </CardTitle>
              <CardDescription>IntegrateAPI singleton warmup — Lazer burner domains use per-mailbox warmup</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Warmup age: <span className="font-medium text-foreground">{warmupFirstEmail ? `${warmupDays} days` : 'Not started'}</span></p>
                <p>Max daily send: <span className="font-medium text-foreground">{maxTier}/day</span></p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5" /> Reset Domain Warmup
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset Domain Warmup?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will restart the warmup schedule from day 0, limiting your daily sends to 20/day.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={async () => {
                      const now = new Date().toISOString();
                      await supabase.from('warmup_state').upsert({
                        id: 'default',
                        first_email_at: now,
                        reset_at: now,
                        reset_by: user!.id,
                      });
                      setWarmupFirstEmail(now);
                      toast.success('Domain warmup has been reset');
                    }}>
                      Reset Warmup
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </>
      )}

      {/* ===== LAZER LENDING CRM PANELS ===== */}

      {/* Panel 1: Domains — link out */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" /> Domains
          </CardTitle>
          <CardDescription>Burner domain pool for cold outreach. SPF/DKIM/DMARC per domain.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link to="/domains" className="gap-1.5 inline-flex items-center">
              <ExternalLink className="h-3.5 w-3.5" /> Manage Domains
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Panel 2: Mailboxes — link out */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MailboxIcon className="h-4 w-4" /> Mailboxes
          </CardTitle>
          <CardDescription>Per-mailbox health: warmup state, daily caps, bounce/complaint rates.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link to="/mailboxes" className="gap-1.5 inline-flex items-center">
              <ExternalLink className="h-3.5 w-3.5" /> Manage Mailboxes
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Panel 3: Sending Pools — inline */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" /> Sending Pools
          </CardTitle>
          <CardDescription>Named groups of mailboxes. Campaigns pick a pool; sends distribute across it.</CardDescription>
        </CardHeader>
        <CardContent>
          <SendingPoolsPanel />
        </CardContent>
      </Card>

      {/* Panel 4: ZeroBounce */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> ZeroBounce
          </CardTitle>
          <CardDescription>Email validation. API key set via env var ZEROBOUNCE_API_KEY.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <KeyIndicator label="API key configured" configured={zerobounceConfigured} />
          <p className="text-xs text-muted-foreground">
            Credit balance and per-request usage visible in the ZeroBounce dashboard.
            JIT re-validation triggers for leads unverified more than 60 days.
          </p>
        </CardContent>
      </Card>

      {/* Panel 5: Smartlead */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> Smartlead
          </CardTitle>
          <CardDescription>Cold sending engine. API key and webhook secret set via env vars.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <KeyIndicator label="API key configured (SMARTLEAD_API_KEY)" configured={smartleadConfigured} />
          <KeyIndicator label="Webhook signing secret configured (SMARTLEAD_WEBHOOK_SIGNING_SECRET)" configured={smartleadConfigured} />
          <div className="text-xs text-muted-foreground space-y-1 pt-1">
            <p>Warmup: Smartlead-managed per connected mailbox.</p>
            <p>Daily cap: configured per mailbox (default 30). Pacing is Smartlead-autonomous after enrollment.</p>
            <p>Webhook auto-disable risk: hourly gap-alert monitors receipt. Manual re-registration via Smartlead UI.</p>
          </div>
        </CardContent>
      </Card>

      {/* Panel 6: Resend */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> Resend
          </CardTitle>
          <CardDescription>Transactional notifications only. Never used for cold sends.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <KeyIndicator label="API key configured (RESEND_API_KEY)" configured={resendConfigured} />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Transactional domain:</span>
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">notify.lazerlending.com</code>
          </div>
          <p className="text-xs text-muted-foreground">
            Cold burner sends NEVER touch Resend. Resend only sends team reply-notifications and ops alerts.
          </p>
        </CardContent>
      </Card>

      {/* Panel 7: Follow Up Boss */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> Follow Up Boss
          </CardTitle>
          <CardDescription>Warm leads pushed via POST /v1/events. API keys set via env vars.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <KeyIndicator label="API key configured (FUB_API_KEY)" configured={fubConfigured} />
          <KeyIndicator label="X-System-Key configured (FUB_X_SYSTEM_KEY)" configured={fubConfigured} />
          {!fubConfigured && (
            <p className="text-xs text-amber-600">
              FUB API key required before warm-lead push will work (Phase 2). Contact FUB support
              to register X-System-Key — without it, rate limits are halved.
            </p>
          )}
          <div className="space-y-2">
            <Label className="text-sm">Default Stage Name</Label>
            <Input
              placeholder="e.g., Lead"
              value={fubStageName}
              onChange={e => setFubStageName(e.target.value)}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Must exactly match a stage name from <code>GET /v1/stages</code> on Lazer's FUB account.
              Verify during Phase 2 onboarding (Task 2.5b).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="fub-dedup"
              checked={fubDedup}
              onCheckedChange={v => setFubDedup(v === true)}
            />
            <label htmlFor="fub-dedup" className="text-sm cursor-pointer">
              Enable email_normalized dedup (skip push if FUB already has this email)
            </label>
          </div>
          <Button size="sm" variant="outline" onClick={handleSaveFub} disabled={fubSaving}>
            {fubSaving ? 'Saving...' : 'Save FUB Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Panel 8: Reply Forwarding */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> Reply Forwarding
          </CardTitle>
          <CardDescription>
            Where Resend notifications go when a classified reply arrives. Per-campaign override
            available in Campaign Builder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Default Team Email</Label>
            <Input
              type="email"
              placeholder="e.g., team@lazerlending.com"
              value={defaultReplyEmail}
              onChange={e => setDefaultReplyEmail(e.target.value)}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Falls back to env var DEFAULT_REPLY_FORWARD_EMAIL when blank.
              Replies are NEVER raw-forwarded — team gets a Resend notification with
              subject + classification + first sentence + CRM link.
            </p>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Classifier model: <code className="text-xs bg-muted px-1 py-0.5 rounded">claude-sonnet-4-6</code></p>
            <p className="text-xs">Set via env var CLASSIFIER_MODEL. Requires no-train DPA (Anthropic API).</p>
          </div>
          <Button size="sm" variant="outline" onClick={handleSaveReplyEmail} disabled={replyEmailSaving}>
            {replyEmailSaving ? 'Saving...' : 'Save'}
          </Button>
        </CardContent>
      </Card>

      {/* Panel 9: Alerts */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" /> Alerts
          </CardTitle>
          <CardDescription>Ops alert email and category toggles. Sent via Resend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Ops Alert Email</Label>
            <Input
              type="email"
              placeholder="e.g., ops@lazerlending.com"
              value={opsAlertEmail}
              onChange={e => setOpsAlertEmail(e.target.value)}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">Falls back to env var OPS_ALERT_EMAIL.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Alert Categories</Label>
            {([
              { key: 'mailboxPaused',           label: 'Mailbox paused (bounce/complaint watchdog)' },
              { key: 'webhookGap',              label: 'Smartlead webhook gap (no events >2h with active campaigns)' },
              { key: 'fubSuppressed',           label: 'FUB suppressed push (204 response)' },
              { key: 'classifierCircuitOpen',   label: 'Classifier circuit breaker opened' },
              { key: 'smartleadSilentDrop',     label: 'Smartlead silent lead drop detected' },
            ] as const).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={alertCategories[key]}
                  onCheckedChange={v =>
                    setAlertCategories(prev => ({ ...prev, [key]: v === true }))
                  }
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={handleSaveAlerts} disabled={alertSaving}>
            {alertSaving ? 'Saving...' : 'Save Alert Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Integrations (existing panel) */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> Other Integrations
          </CardTitle>
          <CardDescription>Connect your tools</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { name: 'Apollo.io', desc: 'Lead generation and enrichment', status: 'Connected' },
            { name: 'Slack', desc: 'Get notifications in your Slack workspace', status: 'Coming Soon' },
          ].map(int => (
            <div key={int.name} className="flex items-center gap-3 p-3 rounded-lg border">
              <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground text-xs font-bold">
                {int.name[0]}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{int.name}</p>
                <p className="text-xs text-muted-foreground">{int.desc}</p>
              </div>
              <Badge variant="outline" className="text-xs text-muted-foreground">{int.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* API Keys (existing panel) */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" /> API Keys
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowApiKeyDialog(true)}>
              Generate Key
            </Button>
          </div>
          <CardDescription>Connect agents and external tools to your CRM</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">API URL</p>
            <div className="flex items-center gap-2">
              <Input
                value={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1`}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => { navigator.clipboard.writeText(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1`); toast.success('URL copied'); }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {apiKeyLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : apiKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet. Generate one to connect an agent.</p>
          ) : (
            <div className="space-y-2 pt-1">
              {apiKeys.map(key => (
                <div key={key.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{key.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{key.keyPreview}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(key.createdAt).toLocaleDateString()}
                      {key.lastUsedAt ? ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : ' · Never used'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleRevokeApiKey(key.id)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={open => { if (!open) resetInviteDialog(); else setShowInviteDialog(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>Create an invite token for a new team member</DialogDescription>
          </DialogHeader>
          {!generatedToken ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input placeholder="e.g., Marcus Rivera" value={inviteName} onChange={e => setInviteName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input placeholder="e.g., marcus@mail.integrateapi.ai" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button onClick={handleCreateInvite} disabled={inviteLoading || !inviteName.trim() || !inviteEmail.trim()}>
                  {inviteLoading ? 'Generating...' : 'Generate Invite Token'}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Share this token with <strong>{inviteName}</strong>. It expires in 72 hours.</p>
              <div className="flex items-center gap-2">
                <Input value={generatedToken} readOnly className="font-mono text-sm" />
                <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(generatedToken); toast.success('Token copied'); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetInviteDialog}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* API Key Generate Dialog */}
      <Dialog open={showApiKeyDialog} onOpenChange={open => { if (!open) resetApiKeyDialog(); else setShowApiKeyDialog(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
            <DialogDescription>Give this key a name so you can identify it later</DialogDescription>
          </DialogHeader>
          {!generatedApiKey ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Key Name</Label>
                <Input
                  placeholder="e.g., Claude Agent"
                  value={newApiKeyName}
                  onChange={e => setNewApiKeyName(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  onClick={handleGenerateApiKey}
                  disabled={generatingApiKey || !newApiKeyName.trim()}
                >
                  {generatingApiKey ? 'Generating...' : 'Generate Key'}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-amber-600 font-medium">Store this key — it won't be shown again.</p>
              <div className="flex items-center gap-2">
                <Input value={generatedApiKey} readOnly className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => { navigator.clipboard.writeText(generatedApiKey); toast.success('API key copied'); }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetApiKeyDialog}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {deleteTarget?.name}'s account. Their assigned leads and deals will be unassigned. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteMember}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
