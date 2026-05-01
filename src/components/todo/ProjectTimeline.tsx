import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { format, parseISO, differenceInDays } from 'date-fns';
import type { Todo, User } from '@/types/crm';

interface Props {
  todos: Todo[];
  profiles: User[];
}

interface PersonBar {
  name: string;
  start: number;
  duration: number;
  taskCount: number;
  completedCount: number;
}

const BAR_COLOR = 'hsl(217.2 91.2% 59.8%)';

export function ProjectTimeline({ todos, profiles }: Props) {
  const { data, minDate } = useMemo(() => {
    if (todos.length === 0) return { data: [], minDate: new Date() };

    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const byPerson = new Map<string, Todo[]>();

    for (const todo of todos) {
      if (!todo.assignedTo) continue;
      const existing = byPerson.get(todo.assignedTo) || [];
      existing.push(todo);
      byPerson.set(todo.assignedTo, existing);
    }

    const allDates = todos.map((t) => parseISO(t.dueDate));
    const earliest = new Date(Math.min(...allDates.map((d) => d.getTime())));

    const bars: PersonBar[] = [];
    for (const [personId, personTodos] of byPerson) {
      const profile = profileMap.get(personId);
      const firstName = profile?.name.split(' ')[0] || 'Unknown';
      const dates = personTodos.map((t) => parseISO(t.dueDate));
      const personMin = new Date(Math.min(...dates.map((d) => d.getTime())));
      const personMax = new Date(Math.max(...dates.map((d) => d.getTime())));
      const startOffset = differenceInDays(personMin, earliest);
      const duration = Math.max(differenceInDays(personMax, personMin), 1);

      bars.push({
        name: firstName,
        start: startOffset,
        duration,
        taskCount: personTodos.length,
        completedCount: personTodos.filter((t) => t.status === 'completed').length,
      });
    }

    return { data: bars, minDate: earliest };
  }, [todos, profiles]);

  if (todos.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No tasks assigned yet
      </div>
    );
  }

  const height = data.length * 40 + 40;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 60, bottom: 10 }}>
        <XAxis
          type="number"
          tickFormatter={(val: number) => format(new Date(minDate.getTime() + val * 86400000), 'MMM d')}
        />
        <YAxis type="category" dataKey="name" width={50} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as PersonBar;
            return (
              <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
                <p className="font-medium">{d.name}</p>
                <p>{d.completedCount}/{d.taskCount} tasks completed</p>
              </div>
            );
          }}
        />
        <Bar dataKey="duration" stackId="a" radius={[4, 4, 4, 4]}>
          {data.map((_, i) => (
            <Cell key={i} fill={BAR_COLOR} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
