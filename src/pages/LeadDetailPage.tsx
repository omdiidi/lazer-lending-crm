import { useParams, useNavigate } from 'react-router-dom';
import { useLeads } from '@/hooks/use-leads';
import { useActivities } from '@/hooks/use-activities';
import { useSuggestions } from '@/hooks/use-suggestions';
import { useProfiles } from '@/hooks/use-profiles';
import { useAuth } from '@/contexts/AuthContext';
import type { LeadStatus, ActivityType } from '@/types/crm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Phone, Mail, MapPin, Building2, Users, Linkedin, Sparkles, Clock, MessageSquare, PhoneCall, MailOpen, Tag, X, Pencil, Save } from 'lucide-react';
import { useState, useEffect } from 'react';
import { incrementCallCount, incrementEmailCount } from '@/lib/api/leads';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  cold: { label: 'Cold', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  lukewarm: { label: 'Lukewarm', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  warm: { label: 'Warm', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  dead: { label: 'Dead', className: 'bg-red-100 text-red-700 border-red-200' },
};

const activityIcons: Record<ActivityType, React.ElementType> = {
  call: PhoneCall,
  email_sent: MailOpen,
  email_received: Mail,
  note: MessageSquare,
  status_change: Tag,
  meeting: Users,
};

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { leads, updateLead, isLoading: leadsLoading } = useLeads();
  const { activities, addActivity } = useActivities(id);
  const { suggestions, dismissSuggestion } = useSuggestions(id);
  const { profiles } = useProfiles();
  const { user } = useAuth();
  const [newNote, setNewNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    jobTitle: '', company: '', companySize: '', industry: '',
    location: '', notes: '', linkedinUrl: '',
  });

  const lead = leads.find(l => l.id === id);

  useEffect(() => {
    if (lead) setEditData({
      firstName: lead.firstName, lastName: lead.lastName, email: lead.email,
      phone: lead.phone, jobTitle: lead.jobTitle, company: lead.company,
      companySize: lead.companySize, industry: lead.industry,
      location: lead.location, notes: lead.notes ?? '', linkedinUrl: lead.linkedinUrl || '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  if (leadsLoading) {
    return <div className="p-6 flex items-center justify-center min-h-[50vh]"><div className="text-sm text-muted-foreground">Loading...</div></div>;
  }

  if (!lead) return <div className="p-6">Lead not found</div>;

  const leadActivities = activities;
  const leadSuggestions = suggestions;
  const assignedUser = profiles.find(p => p.id === lead.assignedTo);

  const handleStatusChange = (status: LeadStatus) => {
    updateLead(lead.id, { status });
    addActivity({
      leadId: lead.id,
      userId: user!.id,
      type: 'status_change',
      description: `Status changed to ${statusConfig[status].label}`,
      timestamp: new Date().toISOString(),
    });
  };

  const handleSave = async () => {
    try {
      updateLead(lead.id, editData);
      setEditing(false);
      toast.success('Lead updated');
    } catch {
      toast.error('Failed to update lead');
    }
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditData({
      firstName: lead.firstName, lastName: lead.lastName, email: lead.email,
      phone: lead.phone, jobTitle: lead.jobTitle, company: lead.company,
      companySize: lead.companySize, industry: lead.industry,
      location: lead.location, notes: lead.notes ?? '', linkedinUrl: lead.linkedinUrl || '',
    });
  };

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    addActivity({
      leadId: lead.id,
      userId: user!.id,
      type: 'note',
      description: newNote.trim(),
      timestamp: new Date().toISOString(),
    });
    setNewNote('');
  };

  const handleCall = () => {
    addActivity({
      leadId: lead.id,
      userId: user!.id,
      type: 'call',
      description: 'Outbound call initiated',
      timestamp: new Date().toISOString(),
    });
    updateLead(lead.id, { lastContactedAt: new Date().toISOString() });
    incrementCallCount([lead.id]);
    // Auto-assign if lead is currently unassigned
    if (!lead.assignedTo) {
      updateLead(lead.id, { assignedTo: user!.id });
    }
    window.location.href = `tel:${lead.phone}`;
  };

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
        return null;
    }
  };

  const handleEmailClick = () => {
    addActivity({
      leadId: lead.id,
      userId: user!.id,
      type: 'email_sent',
      description: 'Email initiated',
      timestamp: new Date().toISOString(),
    });
    updateLead(lead.id, { lastContactedAt: new Date().toISOString() });
    incrementEmailCount([lead.id]);
    window.location.href = `mailto:${lead.email}`;
  };

  return (
    <div className="p-6 max-w-[1200px] space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/leads')} className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Button>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Contact Card */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="border shadow-sm">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  {!editing && (
                    <>
                      <h2 className="text-xl font-semibold text-foreground">{lead.firstName} {lead.lastName}</h2>
                      <p className="text-sm text-muted-foreground">{lead.jobTitle}</p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {!editing ? (
                    <>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Select value={lead.status} onValueChange={(v) => handleStatusChange(v as LeadStatus)}>
                        <SelectTrigger className="w-auto">
                          <Badge variant="outline" className={statusConfig[lead.status].className}>
                            {statusConfig[lead.status].label}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusConfig).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1.5" onClick={handleSave}>
                        <Save className="h-3.5 w-3.5" /> Save
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCancelEdit}>
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {editing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">First Name</Label>
                      <Input value={editData.firstName} onChange={e => setEditData(d => ({ ...d, firstName: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Last Name</Label>
                      <Input value={editData.lastName} onChange={e => setEditData(d => ({ ...d, lastName: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Job Title</Label>
                    <Input value={editData.jobTitle} onChange={e => setEditData(d => ({ ...d, jobTitle: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Company</Label>
                    <Input value={editData.company} onChange={e => setEditData(d => ({ ...d, company: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Company Size</Label>
                      <Input value={editData.companySize} onChange={e => setEditData(d => ({ ...d, companySize: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Industry</Label>
                      <Input value={editData.industry} onChange={e => setEditData(d => ({ ...d, industry: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Location</Label>
                    <Input value={editData.location} onChange={e => setEditData(d => ({ ...d, location: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input value={editData.phone} onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input value={editData.email} onChange={e => setEditData(d => ({ ...d, email: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">LinkedIn URL</Label>
                    <Input value={editData.linkedinUrl} onChange={e => setEditData(d => ({ ...d, linkedinUrl: e.target.value }))} />
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4 flex-shrink-0" />
                    <span>{lead.company} · {lead.companySize} employees</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 flex-shrink-0" />
                    <span>{lead.location}</span>
                  </div>
                  {lead.phone ? (
                    <button onClick={handleCall} className="flex items-center gap-2 text-primary hover:underline w-full">
                      <Phone className="h-4 w-4 flex-shrink-0" />
                      <span>{lead.phone}</span>
                    </button>
                  ) : null}
                  {lead.emailStatus === 'invalid' ? (
                    <div className="flex items-center gap-2 text-muted-foreground cursor-not-allowed w-full min-w-0">
                      <Mail className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate flex-1 line-through">{lead.email}</span>
                      {emailStatusBadge(lead.emailStatus)}
                    </div>
                  ) : (
                    <button onClick={handleEmailClick} className="flex items-center gap-2 text-primary hover:underline w-full min-w-0">
                      <Mail className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate flex-1">{lead.email}</span>
                      {emailStatusBadge(lead.emailStatus)}
                    </button>
                  )}
                  {lead.linkedinUrl && (
                    <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                      <Linkedin className="h-4 w-4 flex-shrink-0" />
                      <span>LinkedIn Profile</span>
                    </a>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                <span>Assigned to {assignedUser?.name}</span>
              </div>

              {lead.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {lead.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Suggestions */}
          {leadSuggestions.length > 0 && (
            <Card className="border shadow-sm border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> AI Action Items
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {leadSuggestions.map(s => (
                  <div key={s.id} className="flex items-start gap-2 p-2 rounded-md bg-primary/5 text-sm">
                    <div className="flex-1">{s.suggestion}</div>
                    <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0" onClick={() => dismissSuggestion(s.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Activity + Notes */}
        <div className="lg:col-span-2 space-y-4">
          {/* Add note */}
          <Card className="border shadow-sm">
            <CardContent className="p-4">
              <div className="flex gap-2">
                <Textarea placeholder="Add a note..." value={newNote} onChange={e => setNewNote(e.target.value)} className="min-h-[60px]" />
                <Button onClick={handleAddNote} disabled={!newNote.trim()} className="self-end">Add</Button>
              </div>
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {leadActivities.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No activity recorded yet</p>
              ) : (
                <div className="space-y-0">
                  {leadActivities.map((act, i) => {
                    const Icon = activityIcons[act.type];
                    const actUser = profiles.find(p => p.id === act.userId);
                    return (
                      <div key={act.id} className="flex gap-3 py-3 relative">
                        {i < leadActivities.length - 1 && (
                          <div className="absolute left-[15px] top-[40px] bottom-0 w-px bg-border" />
                        )}
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 relative z-10">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {act.metadata?.threadId ? (
                            <button onClick={() => navigate(`/outreach?thread=${encodeURIComponent(act.metadata!.threadId)}`)}
                              className="text-sm text-primary hover:underline text-left">
                              {act.description}
                            </button>
                          ) : (
                            <p className="text-sm text-foreground">{act.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              {new Date(act.timestamp).toLocaleString()} · {actUser?.name}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
