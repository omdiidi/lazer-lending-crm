import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, parseISO, isPast, isToday } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { ProjectDetailSheet } from './ProjectDetailSheet';
import { AddTaskToProjectDialog } from './AddTaskToProjectDialog';
import type { Project, Todo, User } from '@/types/crm';

interface Props {
  project: Project;
  todos: Todo[];
  profiles: User[];
}

const statusStyles: Record<string, string> = {
  active: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-800',
};

const priorityDotColors: Record<string, string> = {
  urgent: 'bg-red-500',
  normal: 'bg-blue-500',
  low: 'bg-gray-400',
};

const priorityOrder: Record<string, number> = { urgent: 0, normal: 1, low: 2 };

export function ProjectCard({ project, todos, profiles }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeTodos = todos.filter((t) => t.status === 'active');
  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const progress = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0;

  const overdueCount = activeTodos.filter(
    (t) => t.dueDate && isPast(parseISO(t.dueDate)) && !isToday(parseISO(t.dueDate)),
  ).length;

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const teamMembers = useMemo(() => {
    const uniqueIds = [...new Set(todos.map((t) => t.assignedTo).filter(Boolean))] as string[];
    return uniqueIds.map((id) => profileMap.get(id)).filter(Boolean) as User[];
  }, [todos, profileMap]);

  const displayMembers = teamMembers.slice(0, 4);
  const overflow = teamMembers.length - 4;

  // Top 3 upcoming active tasks: pinned first, then by priority, then by due date
  const upcomingTasks = useMemo(() => {
    return [...activeTodos]
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority];
        const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aTime - bTime;
      })
      .slice(0, 3);
  }, [activeTodos]);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card
          className="cursor-pointer border shadow-sm transition-shadow hover:shadow-md"
          onClick={() => setSheetOpen(true)}
        >
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">{project.title}</h3>
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant="secondary" className={cn('text-xs', statusStyles[project.status])}>
                  {project.status}
                </Badge>
                <div onClick={(e) => e.stopPropagation()}>
                  <AddTaskToProjectDialog
                    projectId={project.id}
                    projectTitle={project.title}
                    profiles={profiles}
                  />
                </div>
              </div>
            </div>

            {project.goal && (
              <p className="line-clamp-3 text-xs text-muted-foreground">{project.goal}</p>
            )}

            {/* Task breakdown stats */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{activeTodos.length}</span> active
              </span>
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{completedCount}</span> done
              </span>
              {overdueCount > 0 && (
                <span className="font-medium text-red-600">
                  {overdueCount} overdue
                </span>
              )}
            </div>

            <div className="space-y-1">
              <Progress value={progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {completedCount}/{todos.length} tasks complete · {progress}%
              </p>
            </div>

            {/* Upcoming tasks preview */}
            {upcomingTasks.length > 0 && (
              <div className="space-y-1 rounded-md border bg-muted/30 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Up next
                </p>
                {upcomingTasks.map((todo) => {
                  const assignee = todo.assignedTo ? profileMap.get(todo.assignedTo) : null;
                  const overdue =
                    todo.dueDate && isPast(parseISO(todo.dueDate)) && !isToday(parseISO(todo.dueDate));
                  return (
                    <div key={todo.id} className="flex items-center gap-2 text-xs">
                      <span
                        className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', priorityDotColors[todo.priority])}
                      />
                      <span className="flex-1 truncate">{todo.title}</span>
                      {assignee && (
                        <span
                          title={assignee.name}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary"
                        >
                          {assignee.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      )}
                      {todo.dueDate && (
                        <span
                          className={cn('shrink-0 text-[10px]', overdue ? 'font-medium text-red-600' : 'text-muted-foreground')}
                        >
                          {format(parseISO(todo.dueDate), 'MMM d')}
                        </span>
                      )}
                    </div>
                  );
                })}
                {activeTodos.length > upcomingTasks.length && (
                  <p className="pt-0.5 text-[10px] text-muted-foreground">
                    + {activeTodos.length - upcomingTasks.length} more
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <div className="flex -space-x-2">
                {displayMembers.map((m) => (
                  <div
                    key={m.id}
                    className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium"
                    title={m.name}
                  >
                    {m.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                ))}
                {overflow > 0 && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium">
                    +{overflow}
                  </div>
                )}
                {teamMembers.length === 0 && (
                  <span className="text-xs text-muted-foreground">No team yet</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {format(parseISO(project.createdAt), 'MMM d, yyyy')}
              </span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <ProjectDetailSheet
        project={project}
        todos={todos}
        profiles={profiles}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
