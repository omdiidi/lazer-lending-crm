import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { UserPlus } from 'lucide-react';
import { TodoMobileAccordionRow } from './TodoMobileAccordionRow';
import type { Todo, Project, User, TodoColumn as TodoColumnType } from '@/types/crm';

interface TodoMobileAccordionProps {
  columns: TodoColumnType[];
  profiles: User[];
  todos: Todo[];
  projects: Project[];
  onRemoveColumn: (columnId: string) => void;
  activeDragId: string | null;
}

export function TodoMobileAccordion({
  columns,
  profiles,
  todos,
  projects,
  onRemoveColumn,
  activeDragId,
}: TodoMobileAccordionProps) {
  const [openProfileId, setOpenProfileId] = useState<string | null>(null);

  const toggle = useCallback((profileId: string) => {
    setOpenProfileId((prev) => (prev === profileId ? null : profileId));
  }, []);

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <UserPlus className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-1 text-sm font-medium text-foreground">No columns yet</h3>
        <p className="max-w-[280px] text-xs text-muted-foreground">
          Add a team member above to create their column, then create to-dos and drag them in.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {columns.map((col) => {
          const profile = profiles.find((p) => p.id === col.profileId);
          if (!profile) return null;
          const personTodos = todos.filter((t) => t.assignedTo === col.profileId);
          const personProjects = projects.filter((p) =>
            personTodos.some((t) => t.projectId === p.id),
          );
          return (
            <motion.div
              key={col.profileId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <TodoMobileAccordionRow
                profileId={col.profileId}
                profile={profile}
                todos={personTodos}
                projects={personProjects.map((p) => ({ id: p.id, title: p.title }))}
                isOpen={openProfileId === col.profileId}
                onToggle={toggle}
                onRemoveColumn={() => onRemoveColumn(col.id)}
                isDragging={!!activeDragId}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
