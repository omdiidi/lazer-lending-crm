import { useState, useMemo } from 'react';
import { Check, Copy, Trash2, BarChart3, List, Circle, Plus } from 'lucide-react';
import { format, parseISO, addDays } from 'date-fns';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useProjects } from '@/hooks/use-projects';
import { useTodos } from '@/hooks/use-todos';
import { useAuth } from '@/contexts/AuthContext';
import { ProjectTimeline } from './ProjectTimeline';
import { AddTaskToProjectDialog } from './AddTaskToProjectDialog';
import type { Project, Todo, User } from '@/types/crm';

interface Props {
  project: Project;
  todos: Todo[];
  profiles: User[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusStyles: Record<string, string> = {
  active: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-800',
};

const priorityDot: Record<string, string> = {
  urgent: 'text-red-500',
  normal: 'text-yellow-500',
  low: 'text-green-500',
};

export function ProjectDetailSheet({ project, todos, profiles, open, onOpenChange }: Props) {
  const { updateProject, deleteProject, duplicateProject } = useProjects();
  const { batchCreateTodos, updateTodo } = useTodos();
  const { user } = useAuth();

  const [showTimeline, setShowTimeline] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [editField, setEditField] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(project.title);
  const [editGoal, setEditGoal] = useState(project.goal || '');
  const [editOutcomes, setEditOutcomes] = useState(project.outcomes || '');
  const [editNotes, setEditNotes] = useState(project.notes || '');

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const progress = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0;
  const allDone = todos.length > 0 && completedCount === todos.length;

  function saveField(field: string) {
    const updates: Partial<Project> = {};
    if (field === 'title') updates.title = editTitle.trim();
    if (field === 'goal') updates.goal = editGoal.trim() || null;
    if (field === 'outcomes') updates.outcomes = editOutcomes.trim() || null;
    if (field === 'notes') updates.notes = editNotes.trim() || null;
    updateProject(project.id, updates);
    setEditField(null);
  }

  async function handleDuplicate() {
    if (!user) return;
    const newProject = await duplicateProject(project.id, user.id);
    const dueDate = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const newTodos = todos.map((t, i) => ({
      title: t.title,
      summary: t.summary,
      details: t.details,
      priority: t.priority,
      dueDate,
      status: 'active' as const,
      assignedTo: t.assignedTo,
      createdBy: user.id,
      projectId: newProject.id,
      isPinned: false,
      isRecurring: false,
      recurrencePattern: null,
      parentTodoId: null,
      position: i,
    }));
    if (newTodos.length > 0) {
      await batchCreateTodos(newTodos);
    }
    toast('Project duplicated');
  }

  function handleComplete() {
    updateProject(project.id, { status: 'completed' });
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteProject(project.id);
    onOpenChange(false);
  }

  function handleToggleTodo(todo: Todo) {
    const newStatus = todo.status === 'completed' ? 'active' : 'completed';
    updateTodo(todo.id, {
      status: newStatus,
      completedAt: newStatus === 'completed' ? new Date().toISOString() : null,
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] overflow-y-auto">
        <SheetHeader>
          {editField === 'title' ? (
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => saveField('title')}
              onKeyDown={(e) => { if (e.key === 'Enter') saveField('title'); }}
              autoFocus
              className="text-lg font-semibold"
            />
          ) : (
            <SheetTitle className="cursor-pointer text-lg" onClick={() => { setEditTitle(project.title); setEditField('title'); }}>
              {project.title}
            </SheetTitle>
          )}
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <Badge variant="secondary" className={cn('text-xs', statusStyles[project.status])}>
            {project.status}
          </Badge>

          <EditableSection
            label="Goal"
            value={project.goal}
            editValue={editGoal}
            isEditing={editField === 'goal'}
            onEdit={() => { setEditGoal(project.goal || ''); setEditField('goal'); }}
            onChange={setEditGoal}
            onSave={() => saveField('goal')}
          />
          <EditableSection
            label="Outcomes"
            value={project.outcomes}
            editValue={editOutcomes}
            isEditing={editField === 'outcomes'}
            onEdit={() => { setEditOutcomes(project.outcomes || ''); setEditField('outcomes'); }}
            onChange={setEditOutcomes}
            onSave={() => saveField('outcomes')}
          />
          <EditableSection
            label="Notes"
            value={project.notes}
            editValue={editNotes}
            isEditing={editField === 'notes'}
            onEdit={() => { setEditNotes(project.notes || ''); setEditField('notes'); }}
            onChange={setEditNotes}
            onSave={() => saveField('notes')}
          />

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{completedCount}/{todos.length} tasks</span>
              <span className="text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant={showTimeline ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowTimeline((v) => !v)}
            >
              {showTimeline ? <List className="mr-1 h-4 w-4" /> : <BarChart3 className="mr-1 h-4 w-4" />}
              {showTimeline ? 'Tasks' : 'Timeline'}
            </Button>
            <AddTaskToProjectDialog
              projectId={project.id}
              projectTitle={project.title}
              profiles={profiles}
              trigger={
                <Button variant="outline" size="sm">
                  <Plus className="mr-1 h-4 w-4" />
                  Add task
                </Button>
              }
            />
          </div>

          {showTimeline ? (
            <ProjectTimeline todos={todos} profiles={profiles} />
          ) : (
            <div className="space-y-1">
              {todos.map((todo) => {
                const assignee = todo.assignedTo ? profileMap.get(todo.assignedTo) : null;
                const done = todo.status === 'completed';
                return (
                  <div
                    key={todo.id}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                      done && 'opacity-60',
                    )}
                  >
                    <button onClick={() => handleToggleTodo(todo)} className="shrink-0">
                      {done ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    <Circle className={cn('h-2 w-2 shrink-0 fill-current', priorityDot[todo.priority])} />
                    <span className={cn('flex-1 truncate', done && 'line-through text-muted-foreground')}>
                      {todo.title}
                    </span>
                    {assignee && (
                      <span className="shrink-0 text-xs text-muted-foreground">{assignee.name}</span>
                    )}
                    {todo.dueDate && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(parseISO(todo.dueDate), 'MMM d')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleDuplicate}>
              <Copy className="mr-1 h-4 w-4" />
              Duplicate
            </Button>
            {allDone && project.status === 'active' && (
              <Button variant="outline" size="sm" onClick={handleComplete}>
                <Check className="mr-1 h-4 w-4" />
                Complete Project
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {confirmDelete ? 'Confirm Delete' : 'Delete'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EditableSection({
  label,
  value,
  editValue,
  isEditing,
  onEdit,
  onChange,
  onSave,
}: {
  label: string;
  value: string | null;
  editValue: string;
  isEditing: boolean;
  onEdit: () => void;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  if (isEditing) {
    return (
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <Textarea
          value={editValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onSave}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(); } }}
          autoFocus
          rows={2}
          className="mt-1"
        />
      </div>
    );
  }

  return (
    <div className="cursor-pointer" onClick={onEdit}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className="mt-0.5 text-sm">{value || <span className="italic text-muted-foreground">Click to add</span>}</p>
    </div>
  );
}
