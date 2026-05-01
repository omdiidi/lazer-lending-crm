import { useTodos } from '@/hooks/use-todos';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ListTodo, AlertTriangle, Clock, Calendar } from 'lucide-react';

export function TodoDashboardWidgets() {
  const { todos, isLoading } = useTodos();
  const { user } = useAuth();

  if (isLoading || !user) return null;

  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const myTodos = todos.filter(t => t.assignedTo === user.id && t.status === 'active');
  const urgentTodos = todos.filter(t => t.priority === 'urgent' && t.status === 'active');
  const overdueTodos = todos.filter(t => t.status === 'active' && new Date(t.dueDate) < now);
  const dueSoon = todos.filter(t => {
    if (t.status !== 'active') return false;
    const due = new Date(t.dueDate);
    return due >= now && due <= threeDaysFromNow;
  });

  const stats = [
    { label: 'My Tasks', value: myTodos.length, icon: ListTodo, color: 'text-primary' },
    { label: 'Urgent', value: urgentTodos.length, icon: AlertTriangle, color: 'text-red-500' },
    { label: 'Overdue', value: overdueTodos.length, icon: Clock, color: 'text-orange-500' },
    { label: 'Due Soon', value: dueSoon.length, icon: Calendar, color: 'text-amber-500' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map(s => (
        <Card key={s.label} className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center mb-2">
              <s.icon className={cn('h-4 w-4', s.color)} />
            </div>
            <p className="text-2xl font-semibold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
