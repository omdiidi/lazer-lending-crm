import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as api from '@/lib/api/todos';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Todo, TodoComment, TodoActivityEntry, TodoColumn, TodoActionType } from '@/types/crm';

// Module-level singleton so pending deletes survive TodoCard remounts triggered by
// realtime cache invalidation. Maps todoId -> browser timer id.
const pendingDeletes = new Map<string, number>();

export function useTodos() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: todos = [], isLoading, error } = useQuery({
    queryKey: ['todos'],
    queryFn: api.getTodos,
  });

  useEffect(() => {
    const channel = supabase
      .channel('todos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => {
        // Skip invalidation while any delete is in its undo window — otherwise a
        // concurrent unrelated write would wipe the optimistic hide.
        if (pendingDeletes.size > 0) return;
        queryClient.invalidateQueries({ queryKey: ['todos'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const createTodoMutation = useMutation({
    mutationFn: (todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>) =>
      api.createTodo(todo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const batchCreateTodosMutation = useMutation({
    mutationFn: (todos: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>[]) =>
      api.batchCreateTodos(todos),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const updateTodoMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Todo> }) =>
      api.updateTodo(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const deleteTodoMutation = useMutation({
    mutationFn: (id: string) => api.deleteTodo(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const logActivityMutation = useMutation({
    mutationFn: ({ todoId, actorId, actionType, details }: {
      todoId: string; actorId: string; actionType: TodoActionType; details?: Record<string, unknown>;
    }) => api.logTodoActivity(todoId, actorId, actionType, details),
  });

  function deleteTodoWithUndo(todo: Todo) {
    // If the same todo is already pending, cancel the prior timer — this click
    // effectively restarts the 5s window (defensive; shouldn't happen in UI).
    const existing = pendingDeletes.get(todo.id);
    if (existing !== undefined) window.clearTimeout(existing);

    // Optimistic hide — all useTodos consumers see the row vanish instantly.
    queryClient.setQueryData<Todo[]>(['todos'], (curr = []) =>
      curr.filter((t) => t.id !== todo.id),
    );

    const timerId = window.setTimeout(() => {
      pendingDeletes.delete(todo.id);
      // Log before the delete. With ON DELETE CASCADE on todo_activity.todo_id,
      // this row may be cascade-deleted; it's logged anyway so the activity
      // exists briefly and survives if the schema is ever changed to SET NULL.
      if (user) {
        logActivityMutation.mutate({
          todoId: todo.id,
          actorId: user.id,
          actionType: 'deleted',
          details: { title: todo.title },
        });
      }
      deleteTodoMutation.mutate(todo.id);
    }, 5000);
    pendingDeletes.set(todo.id, timerId);

    toast(`Deleted "${todo.title}"`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          const id = pendingDeletes.get(todo.id);
          if (id === undefined) return;
          window.clearTimeout(id);
          pendingDeletes.delete(todo.id);
          // Re-add the todo to the cache (rather than restoring a full snapshot)
          // so concurrent edits to other todos during the window aren't clobbered.
          queryClient.setQueryData<Todo[]>(['todos'], (curr = []) => {
            if (curr.some((t) => t.id === todo.id)) return curr;
            return [...curr, todo];
          });
        },
      },
    });
  }

  function createRecurringTodo(completedTodo: Todo) {
    if (!completedTodo.recurrencePattern) return;
    const nextDueDate = api.calculateNextDueDate(completedTodo.dueDate, completedTodo.recurrencePattern);
    createTodoMutation.mutate({
      title: completedTodo.title,
      summary: completedTodo.summary,
      details: completedTodo.details,
      priority: completedTodo.priority,
      dueDate: nextDueDate,
      status: 'active',
      assignedTo: completedTodo.assignedTo,
      createdBy: user?.id || completedTodo.createdBy,
      projectId: completedTodo.projectId,
      isPinned: false,
      isRecurring: true,
      recurrencePattern: completedTodo.recurrencePattern,
      parentTodoId: completedTodo.id,
      position: 0,
    });
  }

  return {
    todos,
    isLoading,
    error,
    createTodo: (todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>) =>
      createTodoMutation.mutateAsync(todo),
    batchCreateTodos: (todos: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>[]) =>
      batchCreateTodosMutation.mutateAsync(todos),
    updateTodo: (id: string, updates: Partial<Todo>) =>
      updateTodoMutation.mutate({ id, updates }),
    deleteTodoWithUndo,
    logActivity: (todoId: string, actorId: string, actionType: TodoActionType, details?: Record<string, unknown>) =>
      logActivityMutation.mutate({ todoId, actorId, actionType, details }),
    createRecurringTodo,
  };
}

export function useTodoColumns() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: columns = [], isLoading } = useQuery({
    queryKey: ['todo-columns', user?.id],
    queryFn: () => api.getTodoColumns(user!.id),
    enabled: !!user,
  });

  useEffect(() => {
    const channel = supabase
      .channel('todo-columns-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_columns' }, () => {
        queryClient.invalidateQueries({ queryKey: ['todo-columns'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const addColumnMutation = useMutation({
    mutationFn: ({ profileId, position }: { profileId: string; position: number }) =>
      api.addTodoColumn(user!.id, profileId, position),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todo-columns'] }),
  });

  const removeColumnMutation = useMutation({
    mutationFn: (id: string) => api.removeTodoColumn(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todo-columns'] }),
  });

  return {
    columns,
    isLoading,
    addColumn: (profileId: string) =>
      addColumnMutation.mutate({ profileId, position: columns.length }),
    removeColumn: (id: string) => removeColumnMutation.mutate(id),
  };
}

export function useTodoComments(todoId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['todo-comments', todoId],
    queryFn: () => api.getTodoComments(todoId),
    enabled: !!todoId,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`todo-comments-${todoId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'todo_comments',
        filter: `todo_id=eq.${todoId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['todo-comments', todoId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient, todoId]);

  const addCommentMutation = useMutation({
    mutationFn: (content: string) =>
      api.addTodoComment(todoId, user!.id, content),
    onSuccess: (_data, content) => {
      queryClient.invalidateQueries({ queryKey: ['todo-comments', todoId] });
      api.logTodoActivity(todoId, user!.id, 'commented', { content });
    },
  });

  return {
    comments,
    isLoading,
    addComment: (content: string) => addCommentMutation.mutate(content),
  };
}

export function useTodoActivity(todoId: string) {
  const queryClient = useQueryClient();

  const { data: activity = [], isLoading } = useQuery({
    queryKey: ['todo-activity', todoId],
    queryFn: () => api.getTodoActivity(todoId),
    enabled: !!todoId,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`todo-activity-${todoId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'todo_activity',
        filter: `todo_id=eq.${todoId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['todo-activity', todoId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient, todoId]);

  return { activity, isLoading };
}
