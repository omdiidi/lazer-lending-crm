/**
 * RepliesPage — Inbox-style view for cold-outreach reply classification.
 *
 * Layout: split pane (mirrors OutreachPage inbox pattern)
 *   Left pane: reply list sorted by received_at desc, with classification badge
 *   Right pane: selected reply detail
 *     - Sender, subject, received_at
 *     - Full body text (raw — operator can see PII, internal-only page)
 *     - Classification badge + confidence
 *     - "Reclassify" dropdown
 *     - "Push to FUB" button (enabled only when classification === 'positive' AND fub_pushed_at IS NULL)
 *     - Stop-on-reply indicator
 *     - Notification status (notified_at + notified_to)
 *     - Requires human review alert
 *
 * Reclassify neutral → positive: automatically triggers FUB push via reclassify mutation.
 */

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { useReplies } from '@/hooks/use-replies';
import type { Reply, ReplyClassification } from '@/hooks/use-replies';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  Mail,
  RefreshCw,
  Send,
  User,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Classification badge config
// ---------------------------------------------------------------------------

interface BadgeConfig {
  label: string;
  className: string;
}

const CLASSIFICATION_CONFIG: Record<ReplyClassification, BadgeConfig> = {
  positive: { label: 'Positive', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  neutral:  { label: 'Neutral',  className: 'bg-amber-100 text-amber-700 border-amber-200' },
  ooo:      { label: 'OOO',      className: 'bg-sky-100 text-sky-700 border-sky-200' },
  unsubscribe: { label: 'Unsubscribe', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  negative: { label: 'Negative', className: 'bg-red-100 text-red-700 border-red-200' },
};

function ClassificationBadge({ label }: { label: ReplyClassification | null }) {
  if (!label) {
    return (
      <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30 text-xs">
        Unclassified
      </Badge>
    );
  }
  const config = CLASSIFICATION_CONFIG[label];
  return (
    <Badge variant="outline" className={`${config.className} text-xs border`}>
      {config.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHrs = diffMs / (1000 * 60 * 60);
  if (diffHrs < 1) return `${Math.max(1, Math.round(diffMs / 60000))}m ago`;
  if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`;
  if (diffHrs < 48) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDatetime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// ReplyListItem
// ---------------------------------------------------------------------------

function ReplyListItem({
  reply,
  isSelected,
  onClick,
}: {
  reply: Reply;
  isSelected: boolean;
  onClick: () => void;
}) {
  const senderName = reply.fromName ?? reply.fromEmail ?? 'Unknown sender';
  const preview = reply.bodyText?.split('\n')[0]?.slice(0, 80) ?? '';

  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 border-b cursor-pointer transition-colors hover:bg-accent/50 ${
        isSelected ? 'bg-accent' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          {reply.requiresHumanReview ? (
            <AlertTriangle className="h-3 w-3 text-amber-500" title="Requires human review" />
          ) : (
            <div className="h-3 w-3" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground truncate">{senderName}</p>
            <span className="text-[11px] text-muted-foreground flex-shrink-0">
              {formatTime(reply.receivedAt)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {reply.subject ?? '(no subject)'}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
          <div className="mt-1.5">
            <ClassificationBadge label={reply.classification} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReplyDetail
// ---------------------------------------------------------------------------

function ReplyDetail({
  reply,
  onReclassify,
  onFubPush,
  isReclassifying,
  isPushing,
}: {
  reply: Reply;
  onReclassify: (label: ReplyClassification) => Promise<void>;
  onFubPush: () => Promise<void>;
  isReclassifying: boolean;
  isPushing: boolean;
}) {
  const [pendingClassification, setPendingClassification] = useState<ReplyClassification | ''>('');

  const canPushToFub =
    reply.classification === 'positive' &&
    !reply.fubPushedAt;

  const hasStopOnReply =
    reply.classification !== null &&
    !(reply.classification === 'negative' && (reply.classifierConfidence ?? 1) <= 0.8);

  const handleReclassify = async () => {
    if (!pendingClassification) return;
    try {
      await onReclassify(pendingClassification);
      toast.success(`Reply reclassified as ${pendingClassification}`);
      setPendingClassification('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reclassification failed');
    }
  };

  const handleFubPush = async () => {
    try {
      await onFubPush();
      toast.success('Pushed to Follow Up Boss');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'FUB push failed');
    }
  };

  const senderName = reply.fromName ?? reply.fromEmail ?? 'Unknown sender';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3 border-b bg-background">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {reply.subject ?? '(no subject)'}
            </h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {senderName}
                {reply.fromEmail && reply.fromName ? ` <${reply.fromEmail}>` : ''}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDatetime(reply.receivedAt)}
              </span>
            </div>
          </div>
          <ClassificationBadge label={reply.classification} />
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 px-5 py-4">
        <div className="space-y-4">
          {/* Human review alert */}
          {reply.requiresHumanReview && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">Requires human review</p>
                {reply.classifierError && (
                  <p className="text-xs mt-0.5 text-amber-700">
                    Classifier error: {reply.classifierError}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Email body (raw — operator-facing, PII visible intentionally) */}
          <div className="rounded-md border bg-muted/20 p-4">
            <pre className="text-sm text-foreground whitespace-pre-wrap font-sans break-words">
              {reply.bodyText ?? '(no body)'}
            </pre>
          </div>

          {/* Classification details */}
          {reply.classification && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Classification
              </h4>
              <div className="flex items-center gap-3">
                <ClassificationBadge label={reply.classification} />
                {reply.classifierConfidence !== null && (
                  <span className="text-xs text-muted-foreground">
                    confidence: {(reply.classifierConfidence * 100).toFixed(0)}%
                  </span>
                )}
                {reply.language && (
                  <span className="text-xs text-muted-foreground uppercase">
                    lang: {reply.language}
                  </span>
                )}
              </div>
              {reply.rationale && (
                <p className="text-xs text-muted-foreground italic">{reply.rationale}</p>
              )}
            </div>
          )}

          {/* Stop-on-reply indicator */}
          {hasStopOnReply && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              Stop-on-reply applied — future sequence steps cancelled
            </div>
          )}

          {/* Notification status */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notification
            </h4>
            {reply.notifiedAt ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                Notified {formatDatetime(reply.notifiedAt)}
                {reply.notifiedTo && <span>→ {reply.notifiedTo}</span>}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Not yet notified
              </div>
            )}
          </div>

          {/* FUB push status */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Follow Up Boss
            </h4>
            {reply.fubPushedAt ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                Pushed to FUB {formatDatetime(reply.fubPushedAt)}
                {reply.fubEventId && (
                  <span className="text-muted-foreground/60">event: {reply.fubEventId}</span>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Not yet pushed</div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Actions footer */}
      <div className="border-t p-4 space-y-3">
        {/* Reclassify */}
        <div className="flex items-center gap-2">
          <Select
            value={pendingClassification}
            onValueChange={(v) => setPendingClassification(v as ReplyClassification)}
          >
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="Reclassify as..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="ooo">OOO</SelectItem>
              <SelectItem value="unsubscribe">Unsubscribe</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={handleReclassify}
            disabled={!pendingClassification || isReclassifying}
          >
            {isReclassifying ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : 'Apply'}
          </Button>
        </div>

        {/* Push to FUB */}
        <Button
          size="sm"
          className="w-full gap-1.5"
          onClick={handleFubPush}
          disabled={!canPushToFub || isPushing}
          title={
            !canPushToFub
              ? reply.fubPushedAt
                ? 'Already pushed to FUB'
                : 'Only positive replies can be pushed to FUB'
              : 'Push this lead to Follow Up Boss'
          }
        >
          {isPushing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Push to Follow Up Boss
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RepliesPage
// ---------------------------------------------------------------------------

export default function RepliesPage() {
  const queryClient = useQueryClient();
  const [selectedReplyId, setSelectedReplyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [classificationFilter, setClassificationFilter] = useState<ReplyClassification | 'all'>('all');
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { replies, isLoading, reclassify, manualPush } = useReplies(
    classificationFilter !== 'all'
      ? { classification: classificationFilter }
      : {},
  );

  const filteredReplies = useMemo(() => {
    if (!search) return replies;
    const q = search.toLowerCase();
    return replies.filter(r =>
      r.fromName?.toLowerCase().includes(q) ||
      r.fromEmail?.toLowerCase().includes(q) ||
      r.subject?.toLowerCase().includes(q) ||
      r.bodyText?.toLowerCase().includes(q),
    );
  }, [replies, search]);

  const selectedReply = filteredReplies.find(r => r.id === selectedReplyId) ?? null;

  const handleRefresh = () => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ['replies'] }).then(() => setRefreshing(false));
  };

  const handleReclassify = async (label: ReplyClassification) => {
    if (!selectedReplyId) return;
    setIsReclassifying(true);
    try {
      await reclassify(selectedReplyId, label);
    } finally {
      setIsReclassifying(false);
    }
  };

  const handleFubPush = async () => {
    if (!selectedReplyId) return;
    setIsPushing(true);
    try {
      await manualPush(selectedReplyId);
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="p-6 max-w-[1200px] space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Replies</h1>
        <p className="text-sm text-muted-foreground">
          Cold-outreach reply inbox — classified and routed automatically
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search replies..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-[240px] h-9"
          />
          <Select
            value={classificationFilter}
            onValueChange={v => setClassificationFilter(v as ReplyClassification | 'all')}
          >
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue placeholder="All classifications" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classifications</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="ooo">OOO</SelectItem>
              <SelectItem value="unsubscribe">Unsubscribe</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {filteredReplies.length} {filteredReplies.length === 1 ? 'reply' : 'replies'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Split pane */}
      <div
        className="flex border rounded-lg bg-background overflow-hidden"
        style={{ height: 'calc(100vh - 240px)', minHeight: '500px' }}
      >
        {/* Left: reply list */}
        <div
          className={`${selectedReply ? 'hidden md:flex' : 'flex'} flex-col border-r w-full md:w-[380px] md:min-w-[380px]`}
        >
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                Loading replies...
              </div>
            ) : filteredReplies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Mail className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No replies found</p>
              </div>
            ) : (
              filteredReplies.map(reply => (
                <ReplyListItem
                  key={reply.id}
                  reply={reply}
                  isSelected={reply.id === selectedReplyId}
                  onClick={() => setSelectedReplyId(reply.id)}
                />
              ))
            )}
          </ScrollArea>
        </div>

        {/* Right: detail pane */}
        <div className={`${selectedReply ? 'flex' : 'hidden md:flex'} flex-col flex-1`}>
          {selectedReply ? (
            <>
              {/* Mobile back button */}
              <div className="flex items-center gap-2 px-4 py-2 border-b md:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSelectedReplyId(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Back to list</span>
              </div>
              <ReplyDetail
                reply={selectedReply}
                onReclassify={handleReclassify}
                onFubPush={handleFubPush}
                isReclassifying={isReclassifying}
                isPushing={isPushing}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <Mail className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">Select a reply to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
