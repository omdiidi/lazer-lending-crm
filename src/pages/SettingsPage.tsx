import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/use-profiles';
import { createInvite, deleteMember } from '@/lib/api/team';
import { getApiKeys, revokeApiKey, type ApiKey } from '@/lib/api/api-keys';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User, Shield, Plug, Trash2, Mail, Copy, RotateCcw, Key } from 'lucide-react';

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
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [apiKeyLoading, setApiKeyLoading] = useState(false)
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false)
  const [newApiKeyName, setNewApiKeyName] = useState('')
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null)
  const [generatingApiKey, setGeneratingApiKey] = useState(false)

  // Warmup state
  const [warmupFirstEmail, setWarmupFirstEmail] = useState<string | null>(null)

  useEffect(() => {
    loadApiKeys()
  }, [])

  const loadApiKeys = async () => {
    setApiKeyLoading(true)
    try {
      const keys = await getApiKeys()
      setApiKeys(keys)
    } catch (err) {
      toast.error('Failed to load API keys')
    } finally {
      setApiKeyLoading(false)
    }
  }

  useEffect(() => {
    supabase.from('warmup_state').select('*').eq('id', 'default').maybeSingle()
      .then(({ data }) => {
        if (data?.first_email_at) setWarmupFirstEmail(data.first_email_at)
      })
  }, [])

  const warmupDays = warmupFirstEmail ? Math.floor((Date.now() - new Date(warmupFirstEmail).getTime()) / (24*60*60*1000)) : 0
  const maxTier = warmupDays >= 91 ? 200 : warmupDays >= 61 ? 150 : warmupDays >= 31 ? 100 : warmupDays >= 22 ? 75 : warmupDays >= 15 ? 50 : warmupDays >= 8 ? 25 : 20

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
    setGeneratingApiKey(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-api-key`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newApiKeyName }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to generate API key')
        return
      }
      setGeneratedApiKey(data.key)
      await loadApiKeys()
    } catch (err) {
      toast.error('Failed to generate API key')
    } finally {
      setGeneratingApiKey(false)
    }
  }

  const handleRevokeApiKey = async (id: string) => {
    try {
      await revokeApiKey(id)
      setApiKeys(prev => prev.filter(k => k.id !== id))
      toast.success('API key revoked')
    } catch {
      toast.error('Failed to revoke API key')
    }
  }

  const resetApiKeyDialog = () => {
    setShowApiKeyDialog(false)
    setNewApiKeyName('')
    setGeneratedApiKey(null)
  }

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

  if (isLoading) {
    return <div className="p-6 flex items-center justify-center min-h-[50vh]"><div className="text-sm text-muted-foreground">Loading...</div></div>;
  }

  return (
    <div className="p-6 max-w-[800px] space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and team</p>
      </div>

      {/* Profile */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" /> Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Prefix</Label>
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
            <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Team Management</CardTitle>
            <CardDescription>Manage employee accounts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profiles.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                  {u.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <Badge variant="secondary" className="capitalize text-xs">{u.role}</Badge>
                {u.role !== 'admin' && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget({ id: u.id, name: u.name })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setShowInviteDialog(true)}>+ Add Team Member</Button>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> Domain Warmup
            </CardTitle>
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
                    This will restart the warmup schedule from day 0, limiting your daily sends to 20/day. Use this if your domain reputation needs rebuilding.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={async () => {
                    const now = new Date().toISOString()
                    await supabase.from('warmup_state').upsert({
                      id: 'default',
                      first_email_at: now,
                      reset_at: now,
                      reset_by: user!.id,
                    })
                    setWarmupFirstEmail(now)
                    toast.success('Domain warmup has been reset')
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

      {/* Integrations */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Plug className="h-4 w-4" /> Integrations</CardTitle>
          <CardDescription>Connect your tools</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { name: 'Apollo.io', desc: 'Lead generation and enrichment', status: 'Connected' },
            { name: 'Email Provider', desc: 'Powered by Resend for reliable email delivery', status: 'Setting Up' },
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

      {/* API Keys */}
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
            <AlertDialogAction onClick={handleDeleteMember} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteLoading ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
