import { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { addDays, format } from 'date-fns';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useProjects } from '@/hooks/use-projects';
import { useTodos } from '@/hooks/use-todos';
import { useAuth } from '@/contexts/AuthContext';
import type { User } from '@/types/crm';

interface Assignment {
  profileId: string;
  profileName: string;
  task: string;
}

export function ProjectCreateDialog({ profiles }: { profiles: User[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [outcomes, setOutcomes] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedPerson, setSelectedPerson] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const { createProject } = useProjects();
  const { batchCreateTodos } = useTodos();
  const { user } = useAuth();

  function resetForm() {
    setTitle('');
    setGoal('');
    setOutcomes('');
    setNotes('');
    setSelectedPerson('');
    setTaskInput('');
    setAssignments([]);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  }

  function handleAssign() {
    if (!selectedPerson || !taskInput.trim()) return;
    const profile = profiles.find((p) => p.id === selectedPerson);
    if (!profile) return;
    setAssignments((prev) => [
      ...prev,
      { profileId: profile.id, profileName: profile.name, task: taskInput.trim() },
    ]);
    setTaskInput('');
  }

  function removeAssignment(index: number) {
    setAssignments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate() {
    if (!user) return;
    const project = await createProject({
      title: title.trim(),
      goal: goal.trim() || null,
      outcomes: outcomes.trim() || null,
      notes: notes.trim() || null,
      status: 'active',
      createdBy: user.id,
    });

    const dueDate = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const todos = assignments.map((a, i) => ({
      title: a.task,
      summary: null,
      details: null,
      priority: 'normal' as const,
      dueDate,
      status: 'active' as const,
      assignedTo: a.profileId,
      createdBy: user.id,
      projectId: project.id,
      isPinned: false,
      isRecurring: false,
      recurrencePattern: null,
      parentTodoId: null,
      position: i,
    }));

    await batchCreateTodos(todos);
    setOpen(false);
    resetForm();
  }

  const canCreate = title.trim().length > 0 && assignments.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FolderPlus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="project-title">Title</Label>
            <Input
              id="project-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project title"
            />
          </div>
          <div>
            <Label htmlFor="project-goal">Goal</Label>
            <Textarea
              id="project-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What's the goal?"
              rows={2}
            />
          </div>
          <div>
            <Label htmlFor="project-outcomes">Outcomes</Label>
            <Textarea
              id="project-outcomes"
              value={outcomes}
              onChange={(e) => setOutcomes(e.target.value)}
              placeholder="Expected outcomes"
              rows={2}
            />
          </div>
          <div>
            <Label htmlFor="project-notes">Notes</Label>
            <Input
              id="project-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>

          <div className="pt-2">
            <Label className="text-xs uppercase tracking-wide">Assign Tasks</Label>
            <div className="mt-2 flex items-center gap-2">
              <Select value={selectedPerson} onValueChange={setSelectedPerson}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Person" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                placeholder="Task description"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAssign();
                  }
                }}
              />
              <Button size="sm" onClick={handleAssign} disabled={!selectedPerson || !taskInput.trim()}>
                Assign
              </Button>
            </div>

            <div className="mt-3 space-y-1">
              <AnimatePresence>
                {assignments.map((a, i) => (
                  <motion.div
                    key={`${a.profileId}-${a.task}-${i}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Badge variant="secondary">{a.profileName}</Badge>
                    <span className="flex-1 truncate">{a.task}</span>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeAssignment(i)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canCreate}>
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
