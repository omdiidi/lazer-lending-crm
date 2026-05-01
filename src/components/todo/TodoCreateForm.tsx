import { useState } from 'react';
import { Plus, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/hooks/use-projects';
import type { Todo, TodoPriority, RecurrencePattern, TodoColumn, User } from '@/types/crm';

const NEW_PROJECT = '__new__';
const NO_PROJECT = '__none__';

interface TodoCreateFormProps {
  onSubmit: (todo: Partial<Todo>) => void;
  columns: TodoColumn[];
  profiles: User[];
}

const emptyForm = {
  title: '',
  summary: '',
  details: '',
  priority: 'normal' as TodoPriority,
  dueDate: '',
  isRecurring: false,
  recurrencePattern: null as RecurrencePattern | null,
  projectSelection: NO_PROJECT as string, // project id, NO_PROJECT, or NEW_PROJECT
  newProjectTitle: '',
};

export function TodoCreateForm({ onSubmit, columns, profiles }: TodoCreateFormProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [enhancing, setEnhancing] = useState<string | null>(null);
  const { user } = useAuth();
  const { projects, createProject } = useProjects();
  const activeProjects = projects.filter((p) => p.status === 'active');

  function reset() {
    setForm({ ...emptyForm });
  }

  async function handleAIEnhance(field: 'summary' | 'details') {
    const text = field === 'details' ? form.details : form.summary;
    if (!text.trim()) return;
    setEnhancing(field);
    try {
      const { data, error } = await supabase.functions.invoke('todo-ai-enhance', {
        body: { text },
      });
      if (error) throw error;
      if (data?.enhanced) {
        setForm((prev) => ({ ...prev, [field]: data.enhanced }));
        toast.success(`${field === 'details' ? 'Details' : 'Summary'} enhanced`);
      }
    } catch (err) {
      console.error('AI enhance error:', err);
      toast.error('Failed to enhance — check that the edge function is deployed');
    } finally {
      setEnhancing(null);
    }
  }

  function buildTodo(assignedTo: string | null, projectId: string | null): Partial<Todo> {
    return {
      title: form.title,
      summary: form.summary || null,
      details: form.details || null,
      priority: form.priority,
      dueDate: form.dueDate || null,
      status: 'active',
      assignedTo,
      createdBy: user?.id || '',
      projectId,
      isPinned: false,
      isRecurring: form.isRecurring,
      recurrencePattern: form.isRecurring ? form.recurrencePattern : null,
      parentTodoId: null,
      position: 0,
    };
  }

  async function resolveProjectId(): Promise<string | null> {
    if (form.projectSelection === NO_PROJECT) return null;
    if (form.projectSelection === NEW_PROJECT) {
      const title = form.newProjectTitle.trim();
      if (!title) {
        toast.error('Enter a name for the new project');
        return null;
      }
      if (!user) return null;
      const p = await createProject({
        title,
        goal: null,
        outcomes: null,
        notes: null,
        status: 'active',
        createdBy: user.id,
      });
      return p.id;
    }
    return form.projectSelection;
  }

  async function handleDone() {
    if (!form.title) {
      toast.error('Title is required');
      return;
    }
    if (form.projectSelection === NEW_PROJECT && !form.newProjectTitle.trim()) {
      toast.error('Enter a name for the new project');
      return;
    }
    const projectId = await resolveProjectId();
    onSubmit(buildTodo(null, projectId));
    reset();
    setOpen(false);
  }

  async function handleApplyToAll() {
    if (!form.title) {
      toast.error('Title is required');
      return;
    }
    if (form.projectSelection === NEW_PROJECT && !form.newProjectTitle.trim()) {
      toast.error('Enter a name for the new project');
      return;
    }
    const projectId = await resolveProjectId();
    const columnProfileIds = columns.map((c) => c.profileId);
    for (const profileId of columnProfileIds) {
      onSubmit(buildTodo(profileId, projectId));
    }
    reset();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add To-Do
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New To-Do</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="todo-title">Title</Label>
            <Input
              id="todo-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="What needs to be done?"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="todo-summary">Summary</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAIEnhance('summary')}
                disabled={enhancing !== null || !form.summary.trim()}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                {enhancing === 'summary' ? 'Enhancing...' : 'AI Enhance'}
              </Button>
            </div>
            <Input
              id="todo-summary"
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="todo-details">Details</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAIEnhance('details')}
                disabled={enhancing !== null || !form.details.trim()}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                {enhancing === 'details' ? 'Enhancing...' : 'AI Enhance'}
              </Button>
            </div>
            <Textarea
              id="todo-details"
              rows={3}
              value={form.details}
              onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select
              value={form.projectSelection}
              onValueChange={(v) => setForm((f) => ({ ...f, projectSelection: v, newProjectTitle: v === NEW_PROJECT ? f.newProjectTitle : '' }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>No project</SelectItem>
                {activeProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                ))}
                <SelectItem value={NEW_PROJECT}>+ Create new project…</SelectItem>
              </SelectContent>
            </Select>
            {form.projectSelection === NEW_PROJECT && (
              <Input
                autoFocus
                placeholder="New project name"
                value={form.newProjectTitle}
                onChange={(e) => setForm((f) => ({ ...f, newProjectTitle: e.target.value }))}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => setForm((f) => ({ ...f, priority: v as TodoPriority }))}
              >
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
              <Label htmlFor="todo-due">Due Date</Label>
              <Input
                id="todo-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={form.isRecurring}
              disabled={!form.dueDate}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isRecurring: v, recurrencePattern: v ? 'weekly' : null }))}
            />
            <Label>Recurring</Label>
            {form.isRecurring && (
              <Select
                value={form.recurrencePattern || 'weekly'}
                onValueChange={(v) => setForm((f) => ({ ...f, recurrencePattern: v as RecurrencePattern }))}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="outline" size="sm" onClick={handleApplyToAll}>
            <Users className="mr-1 h-4 w-4" />
            Apply to All
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleDone}>
              Done
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
