import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, formatDistanceToNow } from 'date-fns';
import { Sparkles, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/lib/supabase';
import { useTodos, useTodoComments, useTodoActivity } from '@/hooks/use-todos';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/use-profiles';
import type { Todo, TodoPriority, TodoComment, TodoActivityEntry } from '@/types/crm';

interface TodoDetailSheetProps {
  todo: Todo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName?: string;
}

type TimelineEntry =
  | { type: 'comment'; data: TodoComment; date: string }
  | { type: 'activity'; data: TodoActivityEntry; date: string };

const actionLabels: Record<string, string> = {
  created: 'created this to-do',
  assigned: 'assigned this to-do',
  reassigned: 'reassigned this to-do',
  completed: 'marked as completed',
  reopened: 'reopened this to-do',
  commented: 'left a comment',
  pinned: 'pinned this to-do',
  unpinned: 'unpinned this to-do',
  priority_changed: 'changed the priority',
  edited: 'edited this to-do',
  deleted: 'deleted this to-do',
};

export function TodoDetailSheet({ todo, open, onOpenChange, projectName }: TodoDetailSheetProps) {
  const { updateTodo, logActivity, deleteTodoWithUndo } = useTodos();
  const { comments, addComment } = useTodoComments(todo.id);
  const { activity } = useTodoActivity(todo.id);
  const { user } = useAuth();
  const { profiles } = useProfiles();

  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [summary, setSummary] = useState(todo.summary || '');
  const [details, setDetails] = useState(todo.details || '');
  const [priority, setPriority] = useState<TodoPriority>(todo.priority);
  const [dueDate, setDueDate] = useState(todo.dueDate || '');
  const [commentText, setCommentText] = useState('');
  const [enhancing, setEnhancing] = useState<string | null>(null);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [
      ...comments.map((c): TimelineEntry => ({ type: 'comment', data: c, date: c.createdAt })),
      ...activity
        .filter((a) => a.actionType !== 'commented')
        .map((a): TimelineEntry => ({ type: 'activity', data: a, date: a.createdAt })),
    ];
    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [comments, activity]);

  function profileName(id: string) {
    return profiles.find((p) => p.id === id)?.name || 'Unknown';
  }

  function profileInitials(id: string) {
    const name = profileName(id);
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function saveField(field: string, value: string | null) {
    updateTodo(todo.id, { [field]: value });
    if (user) logActivity(todo.id, user.id, 'edited', { field });
  }

  function handleTitleBlur() {
    setEditingTitle(false);
    if (title !== todo.title) saveField('title', title);
  }

  function handleSummaryBlur() {
    if (summary !== (todo.summary || '')) saveField('summary', summary || null);
  }

  function handleDetailsBlur() {
    if (details !== (todo.details || '')) saveField('details', details || null);
  }

  function handlePriorityChange(v: string) {
    setPriority(v as TodoPriority);
    updateTodo(todo.id, { priority: v as TodoPriority });
    if (user) logActivity(todo.id, user.id, 'priority_changed', { from: todo.priority, to: v });
  }

  function handleDueDateChange(v: string) {
    setDueDate(v);
    saveField('dueDate', v || null);
  }

  async function handleAIEnhance(field: 'summary' | 'details') {
    const text = field === 'details' ? details : summary;
    if (!text.trim()) return;
    setEnhancing(field);
    try {
      const { data, error } = await supabase.functions.invoke('todo-ai-enhance', {
        body: { text },
      });
      if (error) throw error;
      if (data?.enhanced) {
        if (field === 'details') setDetails(data.enhanced);
        else setSummary(data.enhanced);
        toast.success(`${field === 'details' ? 'Details' : 'Summary'} enhanced`);
      }
    } catch (err) {
      console.error('AI enhance error:', err);
      toast.error('Failed to enhance — check that the edge function is deployed');
    } finally {
      setEnhancing(null);
    }
  }

  function handleAddComment() {
    if (!commentText.trim()) return;
    addComment(commentText.trim());
    setCommentText('');
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] overflow-y-auto">
        <SheetHeader>
          {editingTitle ? (
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
              className="text-lg font-semibold"
            />
          ) : (
            <SheetTitle
              className="cursor-pointer text-left"
              onClick={() => setEditingTitle(true)}
            >
              {title}
            </SheetTitle>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Badge variant="outline" className="text-xs">{priority}</Badge>
            <span className="text-xs text-muted-foreground">
              {dueDate ? `Due ${format(new Date(dueDate), 'MMM d, yyyy')}` : 'No due date'}
            </span>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Summary</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAIEnhance('summary')}
                disabled={enhancing !== null || !summary.trim()}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                {enhancing === 'summary' ? 'Enhancing...' : 'AI Enhance'}
              </Button>
            </div>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onBlur={handleSummaryBlur}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Details</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAIEnhance('details')}
                disabled={enhancing !== null || !details.trim()}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                {enhancing === 'details' ? 'Enhancing...' : 'AI Enhance'}
              </Button>
            </div>
            <Textarea
              rows={4}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              onBlur={handleDetailsBlur}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={handlePriorityChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => handleDueDateChange(e.target.value)}
              />
            </div>
          </div>

          {todo.isRecurring && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3" />
              Recurring {todo.recurrencePattern}
            </div>
          )}

          {projectName && (
            <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-xs">
              {projectName}
            </Badge>
          )}
        </div>

        <Separator className="my-6" />

        <div className="space-y-3">
          <h4 className="text-sm font-medium">Activity</h4>
          <div className="space-y-3">
            {timeline.map((entry) => {
              const actorId = entry.type === 'comment' ? entry.data.authorId : entry.data.actorId;
              return (
                <motion.div
                  key={entry.data.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex gap-2"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {profileInitials(actorId)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs">
                      <span className="font-medium">{profileName(actorId)}</span>{' '}
                      <span className="text-muted-foreground">
                        {entry.type === 'activity'
                          ? actionLabels[entry.data.actionType] || entry.data.actionType
                          : 'left a comment'}
                      </span>
                      <span className="ml-1 text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.date), { addSuffix: true })}
                      </span>
                    </p>
                    {entry.type === 'comment' && (
                      <p className="mt-0.5 text-xs text-foreground">{entry.data.content}</p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Input
            placeholder="Add a comment..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
            className="text-sm"
          />
          <Button size="sm" onClick={handleAddComment} disabled={!commentText.trim()}>
            Add
          </Button>
        </div>

        <Separator className="my-6" />

        <Button
          variant="ghost"
          onClick={() => {
            onOpenChange(false);
            deleteTodoWithUndo(todo);
          }}
          className="w-full justify-center gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          Delete task
        </Button>
      </SheetContent>
    </Sheet>
  );
}
