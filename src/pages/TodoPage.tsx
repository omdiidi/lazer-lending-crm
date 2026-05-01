import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { useTodos, useTodoColumns } from '@/hooks/use-todos';
import { useProjects } from '@/hooks/use-projects';
import { useProfiles } from '@/hooks/use-profiles';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { TodoCard } from '@/components/todo/TodoCard';
import { TodoColumn } from '@/components/todo/TodoColumn';
import { TodoCreateForm } from '@/components/todo/TodoCreateForm';
import { ProjectCreateDialog } from '@/components/todo/ProjectCreateDialog';
import { ProjectCard } from '@/components/todo/ProjectCard';
import { TodoMobileAccordion } from '@/components/todo/TodoMobileAccordion';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserPlus } from 'lucide-react';
import type { Todo } from '@/types/crm';

function UnassignedDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unassigned' });
  return (
    <div ref={setNodeRef} className={cn('transition-colors', isOver && 'ring-2 ring-primary/30 rounded-lg')}>
      {children}
    </div>
  );
}

export default function TodoPage() {
  const [view, setView] = useState<'tasks' | 'projects'>('tasks');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const currentIsMobile = useIsMobile();
  // Freeze isMobile during an active drag so a mid-drag rotation doesn't
  // remount the droppable tree and break the in-progress drag.
  const [frozenIsMobile, setFrozenIsMobile] = useState<boolean | null>(null);
  const isMobile = frozenIsMobile ?? currentIsMobile;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 10 },
    }),
  );
  const { todos, updateTodo, createTodo, logActivity, isLoading: todosLoading } = useTodos();
  const { projects, isLoading: projectsLoading } = useProjects();
  const { columns, addColumn, removeColumn, isLoading: columnsLoading } = useTodoColumns();
  const { profiles } = useProfiles();
  const { user } = useAuth();

  const unassignedTodos = todos.filter(t => t.assignedTo === null && t.status === 'active');
  const activeTodo = activeDragId ? todos.find(t => t.id === activeDragId) : null;

  // Profiles not yet added as columns
  const availableProfiles = profiles.filter(
    p => !columns.some(c => c.profileId === p.id)
  );

  // Project name lookup
  const projectMap = new Map(projects.map(p => [p.id, p.title]));

  function handleDragStart(event: DragStartEvent) {
    setFrozenIsMobile(currentIsMobile);
    setActiveDragId(event.active.id as string);
  }

  // Resolve a drop target ID to a profile ID or 'unassigned'
  function resolveDropTarget(targetId: string): string | null {
    if (targetId === 'unassigned') return 'unassigned';
    // Direct column hit — targetId is a profile ID
    if (columns.some(c => c.profileId === targetId)) return targetId;
    // Hit a card inside a column — find which column owns that card
    const targetTodo = todos.find(t => t.id === targetId);
    if (targetTodo?.assignedTo) return targetTodo.assignedTo;
    // Hit an unassigned card
    if (targetTodo && targetTodo.assignedTo === null) return 'unassigned';
    return null;
  }

  function endDrag() {
    setActiveDragId(null);
    setFrozenIsMobile(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !user) {
      endDrag();
      return;
    }

    const todoId = active.id as string;
    const todo = todos.find(t => t.id === todoId);
    if (!todo) { endDrag(); return; }

    const resolvedTarget = resolveDropTarget(over.id as string);
    if (!resolvedTarget) { endDrag(); return; }

    // Drop on unassigned zone
    if (resolvedTarget === 'unassigned') {
      if (todo.assignedTo !== null) {
        updateTodo(todoId, { assignedTo: null });
        logActivity(todoId, user.id, 'reassigned', { from: todo.assignedTo, to: null });
      }
      endDrag();
      return;
    }

    // Drop on a person column
    if (todo.assignedTo !== resolvedTarget) {
      const actionType = todo.assignedTo === null ? 'assigned' : 'reassigned';
      updateTodo(todoId, { assignedTo: resolvedTarget });
      logActivity(todoId, user.id, actionType, { from: todo.assignedTo, to: resolvedTarget });
    }
    endDrag();
  }

  function handleCreateTodo(todo: Partial<Todo>) {
    if (!user) return;
    createTodo({
      title: todo.title || '',
      summary: todo.summary || null,
      details: todo.details || null,
      priority: todo.priority || 'normal',
      dueDate: todo.dueDate || null,
      status: 'active',
      assignedTo: todo.assignedTo || null,
      createdBy: todo.createdBy || user.id,
      projectId: todo.projectId || null,
      isPinned: false,
      isRecurring: todo.isRecurring || false,
      recurrencePattern: todo.recurrencePattern || null,
      parentTodoId: null,
      position: 0,
    });
  }

  if (todosLoading || columnsLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px]">
      {/* Header — stacks on mobile */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 md:gap-4">
          <h1 className="text-2xl font-semibold text-foreground">To-Do</h1>
          <div className="flex bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setView('tasks')}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-all max-md:min-h-[40px]',
                view === 'tasks'
                  ? 'bg-background shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Tasks
            </button>
            <button
              onClick={() => setView('projects')}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-all max-md:min-h-[40px]',
                view === 'projects'
                  ? 'bg-background shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Projects
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 max-md:flex-wrap">
          <TodoCreateForm
            onSubmit={handleCreateTodo}
            columns={columns}
            profiles={profiles}
          />
          <ProjectCreateDialog profiles={profiles} />
        </div>
      </div>

      {/* Tasks View */}
      {view === 'tasks' && (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          autoScroll={false}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* Add Person */}
          {availableProfiles.length > 0 && (
            <div className="flex items-center gap-2">
              <Select onValueChange={(profileId) => addColumn(profileId)}>
                <SelectTrigger className="w-[200px] h-8 text-sm max-md:h-11">
                  <div className="flex items-center gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />
                    <SelectValue placeholder="Add person..." />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {availableProfiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Unassigned staging area — always rendered as drop target */}
          <UnassignedDropZone>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Unassigned {unassignedTodos.length > 0 && `(${unassignedTodos.length})`}
              </h3>
              <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-dashed bg-muted/30 min-h-[60px]">
                {unassignedTodos.length === 0 ? (
                  <p className="text-xs text-muted-foreground self-center">
                    New to-dos appear here. Drag onto a column to assign.
                  </p>
                ) : (
                  unassignedTodos.map(todo => (
                    <div key={todo.id} className="w-[300px]">
                      <TodoCard
                        todo={todo}
                        projectName={todo.projectId ? projectMap.get(todo.projectId) : undefined}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </UnassignedDropZone>

          {/* Columns: mobile accordion OR desktop grid — mounted exclusively */}
          {isMobile ? (
            <TodoMobileAccordion
              columns={columns}
              profiles={profiles}
              todos={todos}
              projects={projects}
              onRemoveColumn={(columnId) => removeColumn(columnId)}
              activeDragId={activeDragId}
            />
          ) : (
            <>
              {columns.length === 0 && unassignedTodos.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <UserPlus className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">No columns yet</h3>
                  <p className="text-xs text-muted-foreground max-w-[300px]">
                    Add a team member above to create their column, then create to-dos and drag them in.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence>
                  {columns.map(col => {
                    const profile = profiles.find(p => p.id === col.profileId);
                    if (!profile) return null;
                    const columnTodos = todos.filter(t => t.assignedTo === col.profileId);
                    const columnProjects = projects.filter(p =>
                      columnTodos.some(t => t.projectId === p.id)
                    );
                    return (
                      <motion.div
                        key={col.profileId}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      >
                        <TodoColumn
                          profileId={col.profileId}
                          profile={profile}
                          todos={columnTodos}
                          projects={columnProjects.map(p => ({ id: p.id, title: p.title }))}
                          onRemoveColumn={() => removeColumn(col.id)}
                        />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* Drag overlay */}
          <DragOverlay>
            {activeTodo && (
              <motion.div
                initial={{ scale: 1, rotate: 0 }}
                animate={{ scale: 1.03, rotate: 2 }}
                className="shadow-2xl w-[300px]"
              >
                <TodoCard
                  todo={activeTodo}
                  isDragOverlay
                  projectName={activeTodo.projectId ? projectMap.get(activeTodo.projectId) : undefined}
                />
              </motion.div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Projects View */}
      {view === 'projects' && (
        <>
          {projectsLoading ? (
            <div className="text-sm text-muted-foreground">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h3 className="text-sm font-medium text-foreground mb-1">No projects yet</h3>
              <p className="text-xs text-muted-foreground max-w-[300px]">
                Create a project to batch-assign tasks to your team.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <AnimatePresence>
                {projects.map(project => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  >
                    <ProjectCard
                      project={project}
                      todos={todos.filter(t => t.projectId === project.id)}
                      profiles={profiles}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
  );
}
