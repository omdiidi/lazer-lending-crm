import { useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { TodoColumn } from './TodoColumn';
import type { Todo, User } from '@/types/crm';

const SPRING_OPEN_MS = 700;

interface TodoMobileAccordionRowProps {
  profileId: string;
  profile: User;
  todos: Todo[];
  projects: { id: string; title: string }[];
  isOpen: boolean;
  onToggle: (profileId: string) => void;
  onRemoveColumn: () => void;
  isDragging: boolean;
}

export function TodoMobileAccordionRow({
  profileId,
  profile,
  todos,
  projects,
  isOpen,
  onToggle,
  onRemoveColumn,
  isDragging,
}: TodoMobileAccordionRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: profileId });
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isDragging && isOver && !isOpen) {
      timerRef.current = window.setTimeout(() => {
        onToggle(profileId);
      }, SPRING_OPEN_MS);
    }
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isDragging, isOver, isOpen, onToggle, profileId]);

  const activeCount = todos.filter((t) => t.status === 'active').length;
  const initials = profile.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl border bg-card overflow-hidden transition-colors',
        isOver && !isOpen && 'ring-2 ring-primary/40 bg-primary/5',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(profileId)}
        aria-expanded={isOpen}
        aria-controls={`todo-row-panel-${profileId}`}
        className="flex w-full items-center gap-3 p-3 min-h-[56px] text-left active:bg-accent/30 transition-colors"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{profile.name}</p>
          <p className="text-xs text-muted-foreground">
            {activeCount} {activeCount === 1 ? 'task' : 'tasks'}
          </p>
        </div>
        {activeCount > 0 && (
          <Badge variant="secondary" className="rounded-full">
            {activeCount}
          </Badge>
        )}
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-muted-foreground"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="content"
            id={`todo-row-panel-${profileId}`}
            role="region"
            aria-label={`${profile.name}'s tasks`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border-t px-3 pb-3 pt-2">
              <TodoColumn
                profileId={profileId}
                profile={profile}
                todos={todos}
                projects={projects}
                onRemoveColumn={onRemoveColumn}
                isMobileEmbed
                disableDroppable
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
