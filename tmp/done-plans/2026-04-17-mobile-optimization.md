# Plan: Mobile optimization (iPhone 17 Pro Max → iPhone SE)

**Source brief**: `./tmp/briefs/2026-04-17-mobile-optimization.md` (all decisions therein are settled — do not re-litigate).

## Goal

Ship a mobile-only polish pass that makes the CRM feel native and fast on iPhone. Four pillars:

1. **Top-bar "To-Do" shortcut button** — mobile only, routes straight to `/todos`.
2. **44px touch-target pass** — bump `Button sm` and `Button icon` to min 44px on mobile; audit form inputs, dialogs, sheet paddings, header height.
3. **To-Do page mobile accordion** — one-at-a-time expandable rows per person (avatar + name + task-count badge); tap to open; existing task UI appears inside.
4. **@dnd-kit mobile DnD** — add `TouchSensor (delay:250, tolerance:5)` + `autoScroll` enabled + 700ms spring-load that auto-expands a collapsed person row on drag-hover.

Verify with Chrome DevTools MCP at 440×956 (iPhone 17 Pro Max) and 375×667 (iPhone SE) viewports.

## Scope boundary

- **Touch**: `AppLayout`, `AppSidebar` footer, `Button` CVA, `Input`, `TodoPage`, `TodoColumn`, `TodoCard`, `tailwind.config.ts` (add new breakpoint helper if needed), plus a new `TodoMobileAccordion.tsx`.
- **Do not touch**: business logic in `use-todos.ts`, Supabase hooks, the Projects view, any non-mobile layout. Desktop breakpoint (≥768px) must look identical to today.

## Architecture overview

- **Breakpoint contract**: existing `useIsMobile()` (768px) is our mobile switch; we use the same value in Tailwind via the default `md:` utility. We do **not** introduce a new breakpoint.
- **Top-bar button**: `AppLayout.tsx` header gains a single `<Button>` with `ListTodo` icon + "To-Do" label, `className="md:hidden"`, `onClick={() => navigate('/todos')}`. Button active-state is derived from `useLocation().pathname === '/todos'`.
- **Button CVA**: add a `mobile` dimension via responsive tailwind — in practice we add a `min-h-[44px]` / `min-w-[44px]` below `md:` for `sm` and `icon` sizes by editing `buttonVariants` size classes. Desktop sizes unchanged because we append the min-height only at the mobile breakpoint using `max-md:` utilities. Same approach for the input component (`max-md:h-11`).
- **Mobile To-Do**: `TodoPage.tsx` detects `useIsMobile()`. If true, it renders `<TodoMobileAccordion>` in place of the columns grid (unassigned zone + DndContext wrap stay the same). The accordion component owns which person-row is open (`openProfileId` state) — only one open at a time.
- **Accordion row**: collapsed row is a `<button>` with avatar + name + `Badge` count; tapping toggles it open. When open, it embeds the **existing `<TodoColumn>`** (with `isMobileEmbed` prop to drop the redundant person header so the row header isn't duplicated).
- **Droppable target**: the row's outer wrapper registers `useDroppable({ id: profile.id })`. `resolveDropTarget()` in `TodoPage` already returns the `profileId` when a column/person is hit, so no change to drop logic.
- **Spring-load (700ms)**: a new helper `useSpringOpen(onOpen, delayMs)` inside `TodoMobileAccordion` listens for `over` events from `DndContext`. Implementation: the row uses `useDroppable`; when `isOver` flips true, start a `setTimeout(() => onOpen(profileId), 700)`. When `isOver` flips false, clear the timer. If the row opens, the embedded `TodoColumn` is now the active drop target — user drops into it. `DndContext`'s `autoScroll` pans the page so off-screen rows become reachable.
- **TouchSensor**: add alongside `PointerSensor`. With `TouchSensor` delay-250ms tolerance-5px, a tap + immediate swipe scrolls normally; a 250ms hold initiates drag. `PointerSensor` keeps `distance:8` for mouse.
- **Auto-scroll**: pass `autoScroll={{ threshold: { x: 0, y: 0.2 }, acceleration: 10 }}` on `DndContext` — `y:0.2` means the top/bottom 20% of the viewport triggers scroll.

## Files being changed

```
src/
├── components/
│   ├── AppLayout.tsx                          ← MODIFIED (add mobile To-Do button in header)
│   ├── AppSidebar.tsx                         ← (untouched — mobile sheet already works)
│   ├── todo/
│   │   ├── TodoCard.tsx                       ← MODIFIED (bump tap targets: pin + complete icon buttons)
│   │   ├── TodoColumn.tsx                     ← MODIFIED (add `isMobileEmbed?: boolean` prop to hide its own header when embedded in accordion)
│   │   ├── TodoMobileAccordion.tsx            ← NEW (one-at-a-time accordion + spring-load)
│   │   └── TodoMobileAccordionRow.tsx         ← NEW (droppable row with 700ms open-on-hover timer)
│   └── ui/
│       ├── button.tsx                         ← MODIFIED (add `max-md:min-h-[44px] max-md:min-w-[44px]` to sm/icon)
│       └── input.tsx                          ← MODIFIED (add `max-md:h-11 max-md:text-base` so inputs are ≥44px and don't trigger iOS zoom)
├── pages/
│   └── TodoPage.tsx                           ← MODIFIED (branch on useIsMobile → render accordion; add TouchSensor; autoScroll; responsive header)
└── hooks/
    └── use-mobile.tsx                         ← (untouched — already 768px)
```

No new dependencies. Everything uses existing `@dnd-kit/core`, `framer-motion`, `shadcn/ui`, `tailwindcss`, `lucide-react`.

## Key pseudocode

### 1. `AppLayout.tsx` — add mobile To-Do button

```tsx
import { useLocation, useNavigate } from 'react-router-dom';
import { ListTodo } from 'lucide-react';

// inside AppLayout()
const navigate = useNavigate();
const { pathname } = useLocation();
const onTodos = pathname === '/todos';

<header className="h-14 flex items-center border-b bg-background px-4 gap-3">
  <SidebarTrigger />
  {/* Mobile-only quick shortcut */}
  <Button
    size="sm"
    variant={onTodos ? 'default' : 'secondary'}
    onClick={() => navigate('/todos')}
    className="md:hidden gap-1.5"
    aria-current={onTodos ? 'page' : undefined}
  >
    <ListTodo className="h-4 w-4" />
    To-Do
  </Button>
  <div className="ml-auto flex items-center gap-3">…avatar…</div>
</header>
```

### 2. `button.tsx` — touch targets on mobile only

**Critical**: fixed explicit height must be scoped to `md:` so the mobile `min-h` can win. Tailwind merges later utilities, but a concrete `h-9` still resolves the computed height to 36px even with `min-h-[44px]` present (the box-model guarantees min-h wins only when content overflows — empty buttons have no content height, so `h-9` stays 36). Scope the explicit heights to `md:` so mobile is unconstrained and takes the 44px min.

```ts
size: {
  default: "md:h-10 px-4 py-2 max-md:min-h-[44px]",
  sm: "md:h-9 rounded-md px-3 max-md:min-h-[44px] max-md:px-4",
  lg: "h-11 rounded-md px-8",
  icon: "md:h-10 md:w-10 max-md:h-11 max-md:w-11",
},
```

`max-md:` (Tailwind built-in) applies below 768px — desktop is untouched.

### 3. `input.tsx` — 44px on mobile

Existing `text-base` (16px) already prevents iOS zoom — only the height needs bumping:

```tsx
"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ...
 max-md:h-11
 md:text-sm"
```

### 4. `TodoPage.tsx` — sensor + autoScroll + mobile branch

```tsx
import { TouchSensor } from '@dnd-kit/core';
import { useIsMobile } from '@/hooks/use-mobile';
import { TodoMobileAccordion } from '@/components/todo/TodoMobileAccordion';

// NOTE: useIsMobile() is undefined on first render and can cause a layout flash.
// To avoid the flash, we render BOTH trees and toggle visibility with Tailwind
// `md:hidden` / `hidden md:grid` classes. The boolean below is still used for
// non-visual concerns (e.g. reading `openProfileId` behavior) — BUT the mount
// of TodoMobileAccordion and the desktop grid is CSS-gated, not JS-gated.
const isMobile = useIsMobile();

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  // tolerance bumped to 10 so iOS Safari's edge swipe-back gesture (starts with small horizontal
  // movement from left edge) isn't hijacked into a drag.
  useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 10 } }),
);

// Responsive page wrapper — tighter padding on mobile
<div className="p-4 md:p-6 space-y-4 max-w-[1400px]">
  …header (Tasks/Projects toggle)…

  <DndContext
    sensors={sensors}
    collisionDetection={pointerWithin}
    autoScroll={{ threshold: { y: 0.2 }, acceleration: 10 }}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
  >
    {/* Unassigned staging (unchanged) */}
    <UnassignedDropZone>…</UnassignedDropZone>

    {/* Mobile: accordion (hidden on md+) */}
    <div className="md:hidden">
      <TodoMobileAccordion
        columns={columns}
        profiles={profiles}
        todos={todos}
        projects={projects}
        onRemoveColumn={removeColumn}
        activeDragId={activeDragId}
      />
    </div>
    {/* Desktop: existing grid (hidden below md) */}
    <div className="hidden md:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      …existing columns grid…
    </div>

    <DragOverlay>…</DragOverlay>
  </DndContext>
</div>
```

Also: header layout needs to wrap on mobile (`flex-wrap` or stacked) because "Tasks / Projects" toggle + two create buttons overflow 375px — change to `flex-col gap-3 md:flex-row md:items-center md:justify-between`. This header is shared across Tasks and Projects views, so the fix applies globally. Additionally, the **"Add Person" `SelectTrigger`** (currently `h-8 text-sm w-[200px]`) is a standalone non-`Button` control — add `max-md:h-11` to that className too so it meets the touch target rule.

### 5. `TodoMobileAccordion.tsx` — NEW

```tsx
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TodoMobileAccordionRow } from './TodoMobileAccordionRow';

export function TodoMobileAccordion({ columns, profiles, todos, projects, onRemoveColumn, activeDragId }) {
  const [openProfileId, setOpenProfileId] = useState<string | null>(null);

  // STABLE toggle — inline arrows would get a new identity each render, which
  // lands in TodoMobileAccordionRow's useEffect deps and restarts the 700ms
  // spring-load timer on every drag-move (activeDragId changes frequently).
  const toggle = useCallback((profileId: string) => {
    setOpenProfileId(prev => (prev === profileId ? null : profileId));
  }, []);

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {columns.map(col => {
          const profile = profiles.find(p => p.id === col.profileId);
          if (!profile) return null;
          const personTodos = todos.filter(t => t.assignedTo === col.profileId);
          const personProjects = projects.filter(p => personTodos.some(t => t.projectId === p.id));
          return (
            <motion.div
              key={col.profileId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <TodoMobileAccordionRow
                profile={profile}
                todos={personTodos}
                projects={personProjects.map(p => ({ id: p.id, title: p.title }))}
                isOpen={openProfileId === col.profileId}
                onToggle={toggle}
                profileId={col.profileId}
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
```

### 6. `TodoMobileAccordionRow.tsx` — NEW (the important one)

```tsx
import { useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { TodoColumn } from './TodoColumn';

const SPRING_OPEN_MS = 700;

export function TodoMobileAccordionRow({
  profile, profileId, todos, projects, isOpen, onToggle, onRemoveColumn, isDragging,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: profile.id });
  const timerRef = useRef<number | null>(null);

  // Spring-load: if user is dragging AND hovering over this closed row, open after 700ms.
  // IMPORTANT: always clear the prior timer unconditionally at the top so rapid re-renders
  // during drag don't leak timers. Cleanup is also returned unconditionally so unmount
  // always clears. `onToggle` is wrapped in useCallback upstream for stable identity.
  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (isDragging && isOver && !isOpen) {
      timerRef.current = window.setTimeout(() => onToggle(profileId), SPRING_OPEN_MS);
    }
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isDragging, isOver, isOpen, onToggle, profileId]);

  const activeCount = todos.filter(t => t.status === 'active').length;
  const initials = profile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

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
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{profile.name}</p>
          <p className="text-xs text-muted-foreground">
            {activeCount} {activeCount === 1 ? 'task' : 'tasks'}
          </p>
        </div>
        {activeCount > 0 && (
          <Badge variant="secondary" className="rounded-full">{activeCount}</Badge>
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
                profileId={profile.id}
                profile={profile}
                todos={todos}
                projects={projects}
                onRemoveColumn={onRemoveColumn}
                isMobileEmbed
                disableDroppable  /* CRITICAL: avoid duplicate useDroppable({id: profileId}) collision with the row wrapper */
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

### 7. `TodoColumn.tsx` — add `isMobileEmbed` + `disableDroppable` props

```tsx
interface TodoColumnProps {
  profileId: string;
  profile: User;
  todos: Todo[];
  projects: { id: string; title: string }[];
  onRemoveColumn: () => void;
  isMobileEmbed?: boolean;
  disableDroppable?: boolean;
}

export function TodoColumn({ ..., isMobileEmbed, disableDroppable }: TodoColumnProps) {
  // Conditional hook call NOT allowed. Always call useDroppable, but use a throwaway id
  // and ignore isOver when disabled. Alternatively, useDroppable with `disabled: true`:
  const { setNodeRef, isOver } = useDroppable({
    id: profileId,
    disabled: disableDroppable, // @dnd-kit supports this — row wrapper becomes sole droppable
  });

  // Drop the outer card padding/border when embedded.
  return (
    <div
      ref={setNodeRef}
      className={cn(
        !isMobileEmbed && 'min-h-[400px] rounded-xl border bg-card p-4',
        'relative transition-colors',
        !disableDroppable && isOver && 'ring-2 ring-primary/40 bg-primary/5',
      )}
    >
      {!isMobileEmbed && (
        <div className="mb-3 flex items-center gap-2">…existing person header + X button…</div>
      )}
      …rest unchanged…
      {isMobileEmbed && (
        <Button variant="ghost" size="sm" onClick={onRemoveColumn}
                className="mt-3 w-full text-muted-foreground">
          Remove column
        </Button>
      )}
    </div>
  );
}
```

The row header (name, count) lives in the accordion row, so `isMobileEmbed` hides the duplicate inside `TodoColumn`. Remove-column ("X") action is moved — on mobile, the remove button is surfaced as a small "Remove column" footer button inside the embedded column so it remains reachable; on desktop (`!isMobileEmbed`) the existing corner X stays.

**`disableDroppable` is critical**: without it, two droppables share the id `profileId` when the row is open, causing @dnd-kit's registry to overwrite one — drop resolution becomes unreliable.

### 8. `TodoCard.tsx` — touch targets for in-card buttons

The pin button is absolute-positioned (`right-1 top-1`) and the complete button is inline — naively bumping to 44×44 would overflow the card and overlap the title. Use an **expanded hit target via negative margin + padding** so the visible icon stays 24px but the tappable zone becomes 44px. This pattern doesn't shift layout.

```tsx
// Pin button — keep visual size, expand hit area outward on mobile only.
<Button
  variant="ghost"
  size="icon"
  className={cn(
    "absolute right-1 top-1 h-6 w-6",
    // Mobile: negative margin counteracts padding to keep visual position,
    // padding expands the tappable zone to 44x44.
    "max-md:p-[10px] max-md:-m-[10px] max-md:h-11 max-md:w-11 max-md:right-0 max-md:top-0"
  )}
  onClick={handleTogglePin}
>
  <Pin className="h-3.5 w-3.5 …" />
</Button>
```

Same pattern for the complete button at the bottom-right. Result: tappable area 44×44, icon unchanged, visual card layout unchanged. Also bump the card's right padding slightly on mobile (`max-md:pr-8`) so the expanded pin hit zone stays inside the card boundary.

## Tasks (in implementation order)

1. **Edit `src/components/ui/button.tsx`** — update `size` variants so explicit heights are scoped `md:` (so mobile `max-md:min-h-[44px]` actually wins):
   - `default`: `md:h-10 px-4 py-2 max-md:min-h-[44px]`
   - `sm`: `md:h-9 rounded-md px-3 max-md:min-h-[44px] max-md:px-4`
   - `icon`: `md:h-10 md:w-10 max-md:h-11 max-md:w-11`
2. **Edit `src/components/ui/input.tsx`** — add `max-md:h-11` (existing `text-base` already prevents iOS zoom; no text-size change needed).
3. **Edit `src/components/AppLayout.tsx`** — (a) import `useNavigate`, `useLocation`, `ListTodo`; (b) insert mobile "To-Do" `<Button>` with `md:hidden` inside the header after `SidebarTrigger`; (c) wrap the `<main>` with conditional `overscroll-y-contain` class when a drag is active (expose `activeDragId` via context OR add a `data-dragging` attribute listener — simplest: add `overscroll-y-contain` unconditionally on `<main>` since it's a safe default on mobile).
4. **Edit `src/components/todo/TodoCard.tsx`** — expand hit area on pin + complete icon buttons using padding + negative margin pattern (see §8). Add `max-md:pr-8` on the card root so the expanded pin zone stays in bounds.
5. **Edit `src/components/todo/TodoColumn.tsx`** — add optional `isMobileEmbed` prop AND `disableDroppable` prop. Pass `disabled: disableDroppable` into `useDroppable`. When `isMobileEmbed`: skip outer border/padding/min-h, skip the duplicate in-card person header, add a footer "Remove column" ghost button.
6. **Create `src/components/todo/TodoMobileAccordionRow.tsx`** — per pseudocode §6. `useDroppable({id: profileId})`, 700ms spring-load with unconditional cleanup, Framer Motion height animation, embedded `TodoColumn` with both `isMobileEmbed` and `disableDroppable` props, proper `aria-expanded` + `aria-controls` + panel `id`.
7. **Create `src/components/todo/TodoMobileAccordion.tsx`** — per pseudocode §5. Holds `openProfileId` state; wraps toggle in `useCallback` (stable identity for the spring-load effect deps).
8. **Edit `src/pages/TodoPage.tsx`** — (a) add `TouchSensor` import and `useSensor(TouchSensor, {activationConstraint:{delay:250, tolerance:10}})`; (b) add `autoScroll={{ threshold: { y: 0.2 }, acceleration: 10 }}` to `DndContext`; (c) responsive header (`flex-col gap-3 md:flex-row md:items-center md:justify-between`) — applies to both Tasks and Projects views since header is shared; (d) add `max-md:h-11` to the Add Person `SelectTrigger`; (e) render BOTH `<TodoMobileAccordion>` (wrapped in `md:hidden`) and the existing desktop grid (wrapped in `hidden md:grid`) so no flash on first render; desktop grid path otherwise unchanged.
9. **Verification (Chrome DevTools MCP)** — documented below.

## Verification (Chrome DevTools MCP)

Run `npm run dev` in a terminal, then use the MCP tools in this order:

1. `mcp__chrome-devtools__new_page` → open `http://localhost:5173` (or whatever Vite prints).
2. `mcp__chrome-devtools__emulate` → iPhone 17 Pro Max (440×956, DPR 3).
3. Log in (the existing auth flow), navigate to Dashboard.
4. **Verify top-bar "To-Do" button** — `take_screenshot` of header; confirm it's visible, tap (`click`), confirm route changes to `/todos`.
5. **Verify To-Do accordion** — `take_screenshot`; confirm rows show name + count; tap a row → row opens with animation; tap another → first closes, second opens.
6. **Verify spring-load (uses REAL TouchEvents, not PointerEvents)** — `TouchSensor` only responds to `touchstart`/`touchmove`/`touchend`. In Chrome DevTools emulation, touch is synthesized from mouse by default but @dnd-kit's sensor listeners differ. Use `evaluate_script` to dispatch `TouchEvent`s directly on a draggable card: `touchstart` → wait 300ms (past the 250ms delay) → `touchmove` to a target row → wait 800ms (past the 700ms spring-load) → assert row opened via DOM query → `touchmove` into opened list → `touchend` → confirm task reassigned. Take screenshots at each step.
7. **Verify page-scroll coexists with drag** — dispatch short `touchstart`+`touchmove`+`touchend` (<250ms total): page scrolls, no drag. Long-press 300ms+ then move: drag starts, page doesn't scroll.
8. **Verify autoScroll** — drag a card so its pointer is within bottom 20% of viewport; assert `window.scrollY` increases over time.
9. **Verify no duplicate droppable warning** — `list_console_messages` should NOT contain any @dnd-kit warnings about duplicate ids. (If we see one, the `disableDroppable` wiring is wrong.)
10. **Repeat all at 375×667 (iPhone SE)** via `emulate`; confirm no horizontal overflow (`evaluate_script`: `document.body.scrollWidth <= window.innerWidth`), tap targets ≥44px (`getBoundingClientRect().height` on sample buttons).
11. **Verify Projects view on mobile** — toggle to Projects; confirm single-column grid fits 375px, header buttons wrap correctly, no overflow.
12. `list_console_messages` — assert no errors or warnings overall.

## Deprecated / removed code

- None. We add props and branches but don't remove features. The desktop columns grid path in `TodoPage.tsx` is retained unchanged.

## Validation gates

- `npm run lint` — passes (shadcn strictness is already on in the repo).
- `npx tsc --noEmit` — passes (new `isMobileEmbed` prop is typed; new components export typed props).
- Manual Chrome DevTools MCP pass above.

## Known gotchas

- **iOS Safari input zoom**: text inputs under 16px trigger a viewport zoom on focus. Keep `max-md:text-[16px]` on `Input`.
- **`AnimatePresence` + height:auto**: Framer Motion height animation needs `overflow-hidden` on the parent to avoid flicker. Included in the accordion row.
- **`TouchSensor` on an element that's also a button**: tapping the header quickly fires `onClick` (toggle) but a 250ms hold will *not* initiate a drag on the header itself (header is not draggable — it's a `<button>`). Drag only starts from draggable `TodoCard`s, so the header toggle remains responsive.
- **`useDroppable` on the row wrapper** will also catch drops intended for the expanded inner column. That's fine: `resolveDropTarget` in `TodoPage` already resolves both `profileId` and card-inside-column to the same profile target.
- **Autofire spring-load across multiple rows while dragging a long distance**: because the timer is cleared when `isOver` flips false, quick passes don't open other rows. Only sustained hover opens.
- **Scroll-while-drag on iOS**: Passing `touch-action: manipulation` on the draggable cards (already default-ish for buttons) can help; @dnd-kit's `TouchSensor` already sets touch-action internally when active. If cards still fight scroll, add `style={{ touchAction: 'pan-y' }}` on `TodoCard` root motion.div; revisit during verification only if the issue surfaces.
- **iOS rubber-band overscroll during drag**: the `autoScroll` programmatic scroll can jitter against iOS Safari's bounce effect at page edges. Apply `overscroll-behavior-y: contain` on `<main>` (Tailwind `overscroll-y-contain`) so the page won't rubber-band while @dnd-kit is auto-scrolling.
- **iOS swipe-back gesture**: native edge-swipe-back is a short horizontal swipe from the left edge. Setting `TouchSensor` tolerance to `10` (vs the initial 5) keeps the gesture workable on cards near the left edge. If it still conflicts, we can add an edge guard (reject `touchstart` within 16px of `window.innerWidth === 0`).
- **Sidebar Sheet overlay conflict**: the hamburger sidebar is still available on mobile via `SidebarTrigger`; with the new "To-Do" button sitting next to it they should not overlap. Confirm in verification step.

## Confidence: 9/10

(Bumped from 8 after the two review passes caught and fixed: droppable-id collision, `h-9` vs `min-h` precedence, unstable callback re-triggering the spring-load timer, absolute-positioned button overflow, first-render flash, tolerance vs swipe-back, pointer vs touch verification. All addressed in-plan.)
---

## Confidence (pre-review): 8/10

Strong confidence because: (a) decisions are settled in the brief, (b) we reuse all existing components, (c) `@dnd-kit` already supports every pattern we need via props, (d) breakpoint math is trivial with `max-md:`. Half-point deductions for: the card-level touch-target bumps on `TodoCard` (pin/complete) may need visual tweaking once we see them in-situ; and spring-load timing feel may want tuning from 700ms → 600/800 after real-finger testing.
