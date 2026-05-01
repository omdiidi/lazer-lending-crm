import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase, toSnakeCase } from '@/lib/transforms';
import type { Todo, TodoComment, TodoActivityEntry, TodoColumn, TodoActionType } from '@/types/crm';

// ── Todos ──

export async function getTodos(): Promise<Todo[]> {
  // Exclude completed todos older than 30 days for performance
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .is('deleted_at', null)
    .or(`status.eq.active,completed_at.gte.${thirtyDaysAgo.toISOString()}`)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<Todo>(data || []);
}

export async function getTodo(id: string): Promise<Todo | null> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toCamelCase<Todo>(data);
}

export async function createTodo(
  todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>
): Promise<Todo> {
  const snaked = toSnakeCase(todo as unknown as Record<string, unknown>);
  const { data, error } = await supabase
    .from('todos')
    .insert(snaked)
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<Todo>(data);
}

export async function batchCreateTodos(
  todos: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>[]
): Promise<Todo[]> {
  const snaked = todos.map(t => toSnakeCase(t as unknown as Record<string, unknown>));
  const { data, error } = await supabase
    .from('todos')
    .insert(snaked)
    .select();

  if (error) throw error;
  return transformRows<Todo>(data || []);
}

export async function updateTodo(id: string, updates: Partial<Todo>): Promise<void> {
  const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = updates;
  const snaked = toSnakeCase(rest as unknown as Record<string, unknown>);
  const { error } = await supabase
    .from('todos')
    .update(snaked)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteTodo(id: string): Promise<void> {
  const { error } = await supabase
    .from('todos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

// ── Activity Logging ──

export async function logTodoActivity(
  todoId: string,
  actorId: string,
  actionType: TodoActionType,
  details: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase
    .from('todo_activity')
    .insert({
      todo_id: todoId,
      actor_id: actorId,
      action_type: actionType,
      details,
    });

  if (error) throw error;
}

export async function getTodoActivity(todoId: string): Promise<TodoActivityEntry[]> {
  const { data, error } = await supabase
    .from('todo_activity')
    .select('*')
    .eq('todo_id', todoId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return transformRows<TodoActivityEntry>(data || []);
}

// ── Comments ──

export async function getTodoComments(todoId: string): Promise<TodoComment[]> {
  const { data, error } = await supabase
    .from('todo_comments')
    .select('*')
    .eq('todo_id', todoId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return transformRows<TodoComment>(data || []);
}

export async function addTodoComment(
  todoId: string,
  authorId: string,
  content: string
): Promise<TodoComment> {
  const { data, error } = await supabase
    .from('todo_comments')
    .insert({ todo_id: todoId, author_id: authorId, content })
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<TodoComment>(data);
}

// ── Columns ──

export async function getTodoColumns(userId: string): Promise<TodoColumn[]> {
  const { data, error } = await supabase
    .from('todo_columns')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error) throw error;
  return transformRows<TodoColumn>(data || []);
}

export async function addTodoColumn(userId: string, profileId: string, position: number): Promise<TodoColumn> {
  const { data, error } = await supabase
    .from('todo_columns')
    .insert({ user_id: userId, profile_id: profileId, position })
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<TodoColumn>(data);
}

export async function removeTodoColumn(id: string): Promise<void> {
  const { error } = await supabase
    .from('todo_columns')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ── Recurring Logic ──

export function calculateNextDueDate(currentDue: string, pattern: 'daily' | 'weekly' | 'monthly'): string {
  const date = new Date(currentDue);
  switch (pattern) {
    case 'daily': date.setDate(date.getDate() + 1); break;
    case 'weekly': date.setDate(date.getDate() + 7); break;
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
  }
  return date.toISOString().split('T')[0];
}
