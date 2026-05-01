export type UserRole = 'admin' | 'employee';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  emailPrefix?: string;
}

export type LeadStatus = 'cold' | 'lukewarm' | 'warm' | 'dead';

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  company: string;
  companySize: string;
  industry: string;
  location: string;
  status: LeadStatus;
  assignedTo: string; // user id
  createdAt: string;
  lastContactedAt: string | null;
  notes: string;
  tags: string[];
  linkedinUrl?: string;
  emailStatus?: string;
  timezone?: string;
  apolloId?: string;
  callCount?: number;
  emailCount?: number;
}

export type ActivityType = 'call' | 'email_sent' | 'email_received' | 'note' | 'status_change' | 'meeting';

export interface Activity {
  id: string;
  leadId: string;
  userId: string;
  type: ActivityType;
  description: string;
  timestamp: string;
  metadata?: Record<string, string>;
}

export interface EmailMessage {
  id: string;
  leadId?: string;
  campaignId?: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  read: boolean;
  direction: 'inbound' | 'outbound';
  threadId?: string;
  replyToId?: string;
  providerMessageId?: string;
  openedAt?: string;
  clickedAt?: string;
  bouncedAt?: string;
}

export type DealStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';

export interface Deal {
  id: string;
  leadId: string;
  title: string;
  value: number;
  stage: DealStage;
  assignedTo: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailSequence {
  id: string;
  name: string;
  steps: SequenceStep[];
  createdBy: string;
  active: boolean;
}

export interface SequenceStep {
  id: string;
  order: number;
  subject: string;
  body: string;
  delayDays: number;
}

export interface AISuggestion {
  id: string;
  leadId: string;
  suggestion: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
  dismissed: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  recipientIds: string[];
  sentAt: string;
  sentBy: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'scheduled';
  scheduledAt?: string;
  dripConfig?: Record<string, unknown>;
  variantBSubject?: string;
  variantBBody?: string;
  abTestEnabled: boolean;
  sequenceId?: string;
  smartSend?: boolean;
  dailySendLimit?: number;
  sendSpacing?: boolean;
}

export interface CampaignEnrollment {
  id: string;
  campaignId: string;
  leadId?: string;
  email: string;
  status: 'pending' | 'sent' | 'opened' | 'replied' | 'bounced' | 'unsubscribed' | 'failed';
  sentAt?: string;
  nextSendAt?: string;
  currentStep: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdBy: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Unsubscribe {
  id: string;
  leadId?: string;
  email: string;
  token: string;
  unsubscribedAt: string;
}

export interface SearchHistory {
  id: string;
  userId: string;
  prompt: string;
  leads: Lead[];
  filters: Record<string, unknown>;
  totalFound: number;
  creditsUsed: number;
  imported: boolean;
  createdAt: string;
}

// === To-Do & Projects ===

export type TodoPriority = 'urgent' | 'normal' | 'low';
export type TodoStatus = 'active' | 'completed';
export type ProjectStatus = 'active' | 'completed' | 'archived';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly';
export type TodoActionType =
  | 'created'
  | 'assigned'
  | 'reassigned'
  | 'completed'
  | 'reopened'
  | 'commented'
  | 'pinned'
  | 'unpinned'
  | 'priority_changed'
  | 'edited'
  | 'deleted';

export interface Todo {
  id: string;
  title: string;
  summary: string | null;
  details: string | null;
  priority: TodoPriority;
  dueDate: string | null;
  status: TodoStatus;
  assignedTo: string | null;
  createdBy: string;
  projectId: string | null;
  isPinned: boolean;
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern | null;
  parentTodoId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Project {
  id: string;
  title: string;
  goal: string | null;
  outcomes: string | null;
  notes: string | null;
  status: ProjectStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodoComment {
  id: string;
  todoId: string;
  authorId: string;
  content: string;
  createdAt: string;
}

export interface TodoActivityEntry {
  id: string;
  todoId: string;
  actorId: string;
  actionType: TodoActionType;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface TodoColumn {
  id: string;
  userId: string;
  profileId: string;
  position: number;
  createdAt: string;
}
