# Plan: Delete button on TodoCard + detail sheet (hard delete + undo toast)

## Goal

Users can delete a to-do from two places:
1. A small red **trash icon button** at the **bottom-left** of every `TodoCard` (matches the existing pin [top-right] + complete [bottom-right] icon-button pattern).
2. A **"Delete task"** button in the `TodoDetailSheet` slide-out.

Both trigger a **hard delete** with a **5-second Undo window** via a Sonner toast. Clicking Undo restores the todo in the UI immediately.

## Design decisions (settled)

- **Hard delete**: row is removed from DB when the 5s window closes without Undo. No soft-delete column. User picked option A.
- **Undo mechanism**: **React Query optimistic hide**. When delete is fired: snapshot current cache, optimistically remove the row from `queryClient`'s `['todos']` cache, schedule `api.deleteTodo(id)` for 5s later via `setTimeout`, show Sonner toast with "Undo" action. If Undo clicked: clear timeout + restore snapshot. If timer fires: call the real API + log `'deleted'` activity. This leverages React Query's shared cache so ALL components using `useTodos()` see the row vanish/return instantly with no prop-drilling.
- **Activity type**: add `'deleted'` to `TodoActionType`. Logged right before the actual API delete (not on button press).
- **No confirmation dialog**: user explicitly chose fast delete with undo. No AlertDialog.
- **Design language**: shadcn Button `variant="ghost"` with red foreground (`text-red-500 hover:text-red-600 hover:bg-red-50`) — subtle, not aggressive. Lucide `Trash2` icon. No new libraries.

## Architecture overview

All delete logic lives in `useTodos()`. One new method: `deleteTodoWithUndo(todo: Todo): void`. It:

1. Captures an undo snapshot: the full current `['todos']` query cache array.
2. Optimistically mutates the cache: `queryClient.setQueryData(['todos'], old => old.filter(t => t.id !== todo.id))` — this propagates instantly to every component that reads `todos`.
3. Schedules a 5-second timer; the timer handler:
   - Calls `deleteTodoMutation.mutate(todo.id)` — the real DELETE.
   - On success, `logActivityMutation.mutate({ todoId, actorId, actionType: 'deleted', details: { title } })`.
4. Fires `toast(...)` with `action: { label: 'Undo', onClick: () => cancelUndo() }` and `duration: 5000`.
5. `cancelUndo()` clears the timer AND restores the snapshot via `setQueryData`.

Edge cases:
- **Realtime subscription invalidation**: the todos table has a realtime listener (`supabase.channel('todos-realtime')`) that invalidates on any change, including our own eventual delete. During the 5s pending window, if another user edits an unrelated todo, the entire cache refetches and our optimistic filter is lost → the to-be-deleted row briefly reappears, then disappears when the timer fires. This is acceptable (rare race; self-corrects). Documented in gotchas.
- **Multiple pending deletes**: if user deletes several cards rapidly, each has its own snapshot + timer. Store timers + snapshots in a `useRef<Map<todoId, {timerId, snapshot}>>`. Undo of a specific toast restores only that todo's snapshot.
- **Snapshot conflict**: if user deletes todo A, then edits todo B during the pending window, restoring A's snapshot would also wipe the edit to B. Mitigation: restore by *adding back just todo A* instead of restoring the whole array. Use `setQueryData(['todos'], curr => [...curr, deletedTodo])` on undo. Order matters — the card reappears at the end of the list rather than its original position. Minor visual cost, much safer.

## Files being changed

```
src/
├── types/
│   └── crm.ts                                 ← MODIFIED (add 'deleted' to TodoActionType)
├── hooks/
│   └── use-todos.ts                           ← MODIFIED (add deleteTodoWithUndo; internal pending-delete timer map)
├── components/
│   └── todo/
│       ├── TodoCard.tsx                       ← MODIFIED (bottom-left red trash button with 44px mobile hit target)
│       └── TodoDetailSheet.tsx                ← MODIFIED (add "Delete task" button; close sheet after delete; add 'deleted' label to actionLabels map)
└── pages/
    └── TodoPage.tsx                           ← (unchanged)
```

No new files. No new dependencies.

## Key pseudocode

### `src/types/crm.ts` — extend action type

```ts
export type TodoActionType =
  | 'created'
  | 'assigned'
  | 'reassigned'
  | 'completed'
  | 'reopened'
  | 'commented'
  | 'pinned'
  | 'unpinned'
  | 'priority_changed'
  | 'edited'
  | 'deleted';   // <-- new
```

### `src/hooks/use-todos.ts` — add `deleteTodoWithUndo`

Inside `useTodos()`:

```ts
import { useRef } from 'react';
import { toast } from 'sonner';

const pendingDeletesRef = useRef<Map<string, { timerId: number; deletedTodo: Todo }>>(new Map());

function deleteTodoWithUndo(todo: Todo) {
  // 1. Optimistic hide — remove from cache so all views update instantly
  queryClient.setQueryData<Todo[]>(['todos'], (curr = []) =>
    curr.filter((t) => t.id !== todo.id),
  );

  // 2. Schedule the real delete after 5s
  const timerId = window.setTimeout(() => {
    pendingDeletesRef.current.delete(todo.id);
    // Log the activity BEFORE the delete so the activity row exists even momentarily
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

  pendingDeletesRef.current.set(todo.id, { timerId, deletedTodo: todo });

  // 3. Toast with Undo
  toast(`Deleted "${todo.title}"`, {
    duration: 5000,
    action: {
      label: 'Undo',
      onClick: () => {
        const entry = pendingDeletesRef.current.get(todo.id);
        if (!entry) return;
        window.clearTimeout(entry.timerId);
        pendingDeletesRef.current.delete(todo.id);
        // Restore by ADDING the todo back (safer than restoring the whole snapshot —
        // won't clobber other edits that happened during the pending window).
        queryClient.setQueryData<Todo[]>(['todos'], (curr = []) => {
          if (curr.some((t) => t.id === entry.deletedTodo.id)) return curr;
          return [...curr, entry.deletedTodo];
        });
      },
    },
  });
}
```

Add to the hook's returned object:

```ts
return {
  // ...existing...
  deleteTodoWithUndo,
};
```

### `src/components/todo/TodoCard.tsx` — bottom-left delete button

Current structure:
```tsx
<div className="mt-2 flex justify-end">
  <Button … onClick={handleComplete}>…</Button>
</div>
```

Change to `flex justify-between` with delete on the left, complete on the right:

```tsx
<div className="mt-2 flex items-center justify-between">
  <Button
    variant="ghost"
    size="icon"
    aria-label="Delete task"
    className={cn(
      "h-6 w-6 text-red-500 hover:bg-red-50 hover:text-red-600",
      "max-md:h-11 max-md:w-11 max-md:p-[10px] max-md:min-h-0",
      "touch-none select-none",
    )}
    onClick={handleDelete}
  >
    <Trash2 className="h-3.5 w-3.5 max-md:h-4 max-md:w-4" />
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
```

Handler:

```tsx
const { deleteTodoWithUndo } = useTodos();

function handleDelete(e: React.MouseEvent) {
  e.stopPropagation();  // prevent the card's onClick (open detail sheet) from firing
  deleteTodoWithUndo(todo);
}
```

Also: import `Trash2` from `lucide-react`.

### `src/components/todo/TodoDetailSheet.tsx` — add Delete task button

At the very bottom of the `SheetContent` (below the comment-add row), add a subtle destructive button:

```tsx
import { Trash2 } from 'lucide-react';

// inside the component, after destructuring useTodos:
const { updateTodo, logActivity, deleteTodoWithUndo } = useTodos();

function handleDelete() {
  deleteTodoWithUndo(todo);
  onOpenChange(false);  // close the sheet immediately
}

// ...at the bottom of SheetContent, after the comment input row:
<Separator className="my-6" />
<Button
  variant="ghost"
  onClick={handleDelete}
  className="w-full justify-center gap-2 text-red-500 hover:bg-red-50 hover:text-red-600"
>
  <Trash2 className="h-4 w-4" />
  Delete task
</Button>
```

Also extend `actionLabels` so the activity feed renders nicely (even though the row is usually gone before the feed is consulted):

```ts
const actionLabels: Record<string, string> = {
  // ...existing...
  deleted: 'deleted this to-do',
};
```

## Tasks (in implementation order)

1. **Edit `src/types/crm.ts`** — append `'deleted'` to `TodoActionType`.
2. **Edit `src/hooks/use-todos.ts`** —
   - Add `import { useRef } from 'react'` (already has `useEffect`).
   - Add `import { toast } from 'sonner'`.
   - Inside `useTodos`: declare `pendingDeletesRef` via `useRef`.
   - Implement `deleteTodoWithUndo(todo: Todo)` per pseudocode.
   - Expose it in the hook's return object.
   - Keep the existing `deleteTodo` method (used elsewhere? grep to confirm — if unused, remove to avoid ambiguity).
3. **Edit `src/components/todo/TodoCard.tsx`** —
   - Import `Trash2` from `lucide-react`.
   - Destructure `deleteTodoWithUndo` from `useTodos()`.
   - Add `handleDelete(e)` with `e.stopPropagation()`.
   - Change the bottom flex row to `justify-between` + add the delete Button before the complete Button.
4. **Edit `src/components/todo/TodoDetailSheet.tsx`** —
   - Import `Trash2`.
   - Destructure `deleteTodoWithUndo` from `useTodos()`.
   - Add `handleDelete()` that calls `deleteTodoWithUndo(todo)` then `onOpenChange(false)`.
   - Add the `<Separator />` + `<Button>Delete task</Button>` block at the very bottom of `SheetContent`.
   - Add `deleted: 'deleted this to-do'` to `actionLabels`.
5. **Verify**:
   - `./node_modules/.bin/tsc --noEmit` passes.
   - `npm run lint` has no NEW issues.
6. **Commit + push to `main-9` and fast-forward to `main`** (pre-approved by user).

## Deprecated / removed code

- Old `deleteTodo` (non-undo version) returned from `useTodos()` at line 88. Check with `grep` whether any other component uses it. If **no** usages outside of what we're about to change: remove it from the returned object and rely on `deleteTodoWithUndo` everywhere. If there are other usages, leave it (no harm — it's just an alternative path).

## Known gotchas

- **Realtime cache invalidation during pending window**: the `supabase.channel('todos-realtime')` listener invalidates `['todos']` on any change. Unrelated concurrent edits (by another user) will trigger a refetch that re-pulls the row we optimistically hid. Result: the row briefly reappears, then disappears when our 5s timer fires. Rare; acceptable; not fixing.
- **Hook instances**: `useTodos()` is called in multiple components. `pendingDeletesRef` is per-hook-instance. That's fine because we only invoke `deleteTodoWithUndo` from ONE place at a time (the button user clicks), and the optimistic cache update via `queryClient.setQueryData` is global (shared across all instances). Other components see the hide without needing their own refs.
- **Trash2 icon size on mobile**: the expanded-hit-target pattern (padding + h-11 w-11) can visually blow up the icon if we aren't careful. Solution: icon stays `h-3.5 w-3.5` on desktop, bumps slightly to `h-4 w-4` on mobile for better visibility in the 44px target. The 44px is the tappable area; the visible icon stays small.
- **Activity log ordering**: `logActivityMutation.mutate` is fire-and-forget; we call it BEFORE `deleteTodoMutation.mutate(todo.id)`. If the activity table has a FK to todos with ON DELETE CASCADE, the activity row may be deleted along with the todo. This is a DB concern outside this plan's scope — if logs need to survive, the DB schema should use ON DELETE SET NULL for the todo_id FK. For now, log-before-delete is the right pattern.
- **`e.stopPropagation()` on the delete button click**: critical. Without it, the card's root `onClick={() => !isDragging && setSheetOpen(true)}` would also fire → sheet opens for a to-do that's about to be deleted.

## Validation gates

- `./node_modules/.bin/tsc --noEmit` — passes.
- `npm run lint` — no new errors.
- Manual test (user on iPhone + desktop):
  1. Desktop: click the red trash on a card → card vanishes, toast shows "Deleted [title]" with Undo. Click Undo within 5s → card returns. Let another card's toast time out → card stays gone after 5s.
  2. Desktop: click a card to open the detail sheet → click "Delete task" at the bottom → sheet closes, card vanishes, toast shows Undo.
  3. Mobile: same flows. Trash button must be tappable at 44px without hitting adjacent elements. Toast must be visible above the mobile bottom nav.

## Confidence: 9/10

Strong: one new hook method, two component edits, a trivial type addition. The optimistic-cache pattern is textbook React Query. Only half-point deductions for (a) the realtime-invalidation race (rare but real) and (b) uncertainty about any other caller of `deleteTodo` that I haven't grepped yet.
