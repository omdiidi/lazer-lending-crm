import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTodos } from '@/hooks/use-todos';
import { useAuth } from '@/contexts/AuthContext';
import type { TodoPriority, User } from '@/types/crm';

interface Props {
  projectId: string;
  projectTitle: string;
  profiles: User[];
  trigger?: React.ReactNode;
}

const emptyForm = {
  title: '',
  assignedTo: 'unassigned',
  priority: 'normal' as TodoPriority,
  dueDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
};

export function AddTaskToProjectDialog({ projectId, projectTitle, profiles, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const { createTodo } = useTodos();
  const { user } = useAuth();

  function reset() {
    setForm({ ...emptyForm });
  }

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!user) return;
    try {
      await createTodo({
        title: form.title.trim(),
        summary: null,
        details: null,
        priority: form.priority,
        dueDate: form.dueDate || null,
        status: 'active',
        assignedTo: form.assignedTo === 'unassigned' ? null : form.assignedTo,
        createdBy: user.id,
        projectId,
        isPinned: false,
        isRecurring: false,
        recurrencePattern: null,
        parentTodoId: null,
        position: 0,
      });
      toast.success('Task added to project');
      reset();
      setOpen(false);
    } catch (err) {
      console.error('Failed to add task:', err);
      toast.error('Failed to add task');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger ?? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add task to project"
            className="h-7 w-7 text-primary hover:bg-primary/10"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Add task to {projectTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="project-task-title">Title</Label>
            <Input
              id="project-task-title"
              autoFocus
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="What needs to be done?"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Assign to</Label>
            <Select
              value={form.assignedTo}
              onValueChange={(v) => setForm((f) => ({ ...f, assignedTo: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <Label htmlFor="project-task-due">Due Date</Label>
              <Input
                id="project-task-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit}>Add task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
