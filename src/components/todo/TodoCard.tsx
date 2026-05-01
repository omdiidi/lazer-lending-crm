import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { format, isPast, isToday } from 'date-fns';
import { CheckCircle2, Pin, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTodos } from '@/hooks/use-todos';
import { useAuth } from '@/contexts/AuthContext';
import { TodoDetailSheet } from './TodoDetailSheet';
import type { Todo } from '@/types/crm';

interface TodoCardProps {
  todo: Todo;
  isDragOverlay?: boolean;
  projectName?: string;
}

const priorityColors: Record<string, string> = {
  urgent: 'border-l-red-500',
  normal: 'border-l-blue-500',
  low: 'border-l-gray-400',
};

const priorityDotColors: Record<string, string> = {
  urgent: 'bg-red-500',
  normal: 'bg-blue-500',
  low: 'bg-gray-400',
};

export function TodoCard({ todo, isDragOverlay, projectName }: TodoCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { updateTodo, logActivity, createRecurringTodo, deleteTodoWithUndo } = useTodos();
  const { user } = useAuth();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: todo.id, disabled: todo.status === 'completed' });

  const style: React.CSSProperties = {
    ...(transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : {}),
    WebkitTouchCallout: 'none',
    WebkitUserDrag: 'none',
  } as React.CSSProperties;

  const isCompleted = todo.status === 'completed';
  const isOverdue = !isCompleted && !!todo.dueDate && isPast(new Date(todo.dueDate)) && !isToday(new Date(todo.dueDate));

  function handleTogglePin(e: React.MouseEvent) {
    e.stopPropagation();
    const newPinned = !todo.isPinned;
    updateTodo(todo.id, { isPinned: newPinned });
    if (user) {
      logActivity(todo.id, user.id, newPinned ? 'pinned' : 'unpinned');
    }
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    deleteTodoWithUndo(todo);
  }

  function handleComplete(e: React.MouseEvent) {
    e.stopPropagation();
    if (isCompleted) {
      updateTodo(todo.id, { status: 'active', completedAt: null });
      if (user) logActivity(todo.id, user.id, 'reopened');
    } else {
      updateTodo(todo.id, { status: 'completed', completedAt: new Date().toISOString() });
      if (user) logActivity(todo.id, user.id, 'completed');
      if (todo.isRecurring) createRecurringTodo(todo);
    }
  }

  return (
    <>
      <motion.div
        ref={isDragOverlay ? undefined : setNodeRef}
        style={isDragOverlay ? undefined : style}
        {...(isDragOverlay ? {} : attributes)}
        {...(isDragOverlay ? {} : listeners)}
        layout={!isDragOverlay}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: isCompleted ? 0.5 : isDragging ? 0.4 : 1, y: 0 }}
        className={cn(
          'relative cursor-grab rounded-lg border border-l-[3px] bg-card p-3 shadow-sm transition-shadow hover:shadow-md max-md:pr-8',
          'touch-none select-none',
          priorityColors[todo.priority],
          todo.priority === 'urgent' && !isCompleted && 'bg-red-50/50',
          isOverdue && 'ring-1 ring-red-300 bg-red-50/30',
          isDragging && 'opacity-40',
        )}
        onClick={() => !isDragging && setSheetOpen(true)}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 h-6 w-6 max-md:h-11 max-md:w-11 max-md:right-0 max-md:top-0 max-md:p-[10px] max-md:min-h-0 touch-none select-none"
          onClick={handleTogglePin}
        >
          <Pin
            className={cn(
              'h-3.5 w-3.5',
              todo.isPinned ? 'fill-blue-500 text-blue-500' : 'text-muted-foreground',
            )}
          />
        </Button>

        <p className={cn('pr-6 text-sm font-medium', isCompleted && 'line-through opacity-50')}>
          {todo.title}
        </p>

        {todo.summary && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{todo.summary}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full', priorityDotColors[todo.priority])} />
            {todo.priority}
          </Badge>

          {todo.dueDate && (
            <span className={cn('text-[11px] text-muted-foreground', isOverdue && 'font-medium text-red-600')}>
              {format(new Date(todo.dueDate), 'MMM d')}
            </span>
          )}

          {projectName && (
            <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px] px-1.5 py-0">
              {projectName}
            </Badge>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete task"
            disabled={isDragging}
            className="h-6 w-6 min-h-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:text-green-600 max-md:h-11 max-md:w-11 max-md:p-[10px] max-md:min-h-0 touch-none select-none"
            onClick={handleComplete}
          >
            <CheckCircle2 className={cn('h-4 w-4', isCompleted && 'text-green-600')} />
          </Button>
        </div>
      </motion.div>

      <TodoDetailSheet
        todo={todo}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        projectName={projectName}
      />
    </>
  );
}
