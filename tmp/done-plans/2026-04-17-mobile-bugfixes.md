# Plan: Mobile bugfixes + desktop scroll regression

Follow-up to `tmp/done-plans/2026-04-17-mobile-optimization.md` — three post-deploy bugs surfaced during real-device use.

## Bugs

### Bug 1 — mobile drag over a contact does nothing
On iPhone, the user creates a new unassigned task, starts dragging the card, hovers over a (closed) contact row — nothing happens. The row does not spring-open after 700ms, and dropping does not assign.

### Bug 2 — iOS "Copy / Look Up / Translate" callout appears
Touching the new unassigned card triggers the iOS text-selection callout menu in the top-left corner. Additionally, the user observes that **the "normal" priority label text on the card gets visually highlighted** when held — confirming iOS is resolving the touch as text selection, not a drag.

### Bug 3 — desktop `/todos` can't be scrolled with the mouse wheel
On desktop, the user cannot scroll the `/todos` page with the wheel/trackpad. The content only scrolls when the user clicks and drags the browser's scrollbar. No other page has this regression.

## Root-cause analysis

### Bugs 1 + 2 + the text-highlight share a single root cause

The draggable `TodoCard` in `src/components/todo/TodoCard.tsx` has no touch-action / user-select / webkit-touch-callout CSS. When iOS Safari receives a touch on text inside the card:

1. iOS begins its native ~500ms long-press → text-selection + callout gesture.
2. Our `TouchSensor` also tries to claim the touch after a 250ms `delay`.
3. iOS wins: it shows the callout menu, selects the "normal" text, and cancels the touch from reaching @dnd-kit.
4. @dnd-kit's `TouchSensor.activationConstraint.tolerance: 10` means any finger movement ≥10px *during* the 250ms delay also aborts activation — but since iOS already hijacked the touch, the drag never starts.

No drag → no `isOver` on any droppable row → no spring-load timer → "doesn't do anything."

### Bug 3 — desktop scroll

The prior plan used a **CSS split** so both the mobile accordion and the desktop grid mount simultaneously, one hidden via `md:hidden` / `hidden md:grid`. This looked good on paper but has a subtle cost: each `TodoMobileAccordionRow` calls `useDroppable({ id: profileId })` even on desktop where it's `display:none`. Those droppables register in @dnd-kit's context registry; @dnd-kit's collision detection measures their bounding rects (0×0 because display:none), and PointerSensor attaches a `pointermove` listener to `document` with `{passive: false}`.

The combination doesn't strictly prove the regression, but it's the only plausible source of scroll interference on `/todos` that doesn't exist on other pages. Simplest correct fix: **don't mount the mobile accordion on desktop**. This also eliminates a class of "hidden mount" bugs entirely (hidden droppables, phantom event handlers, unnecessary render cost).

## Fixes

### Fix A — touch CSS on `TodoCard` (covers bugs 1, 2, text-highlight)

Add to the draggable root of `TodoCard`:

- `touch-none` → Tailwind for `touch-action: none` (tells the browser this element handles its own touch gestures; disables iOS long-press text-selection and scroll-from-element).
- `select-none` → Tailwind for `user-select: none` (prevents text selection highlight).
- Inline style `WebkitTouchCallout: 'none'` (no Tailwind utility in this repo — prevents iOS's Copy/Look Up/Translate callout). Alternatively: add an arbitrary-value utility `[-webkit-touch-callout:none]`.

Result: iOS no longer claims the touch → `TouchSensor` activates after 250ms → drag starts cleanly → spring-load on hover works → drop assigns correctly. No callout, no text highlight.

### Fix B — conditionally mount accordion vs grid (covers bug 3)

Replace the CSS-split with a JS branch using `useIsMobile()` — **BUT first make the hook initialize synchronously** so there is no wrong-tree first render. The current hook returns `!!undefined === false` on first render, which means on mobile we'd briefly mount the desktop grid and its `useDroppable` hooks would register for ~1 frame before being unmounted. That's a stale-registration race. Make the hook read `window.innerWidth` synchronously in its `useState` initializer.

### Fix B-fallback — if bug 3 persists after Fix B

If the scroll regression remains after unmounting the hidden accordion, the next suspect is `autoScroll={{…}}` on `DndContext` (line 199 of `TodoPage.tsx`). Set `autoScroll={false}`. @dnd-kit's autoScroll is only useful during a drag and we can live without it on desktop. This is a one-line revert and will be tried if Fix B alone doesn't resolve wheel-scroll.

### Fix C — retain `overscroll-y-contain` on `<main>`

No change. It's defensive for iOS rubber-band during drag and doesn't affect desktop scroll. Keeping it.

## Files being changed

```
src/
├── components/
│   ├── AppLayout.tsx                          ← (unchanged — overscroll-y-contain stays)
│   └── todo/
│       ├── TodoCard.tsx                       ← MODIFIED (touch-none select-none on card root AND on pin+complete buttons; inline WebkitTouchCallout + WebkitUserDrag on card root)
│       ├── TodoMobileAccordion.tsx            ← (unchanged)
│       ├── TodoMobileAccordionRow.tsx         ← (unchanged)
│       └── TodoColumn.tsx                     ← (unchanged)
├── hooks/
│   └── use-mobile.tsx                         ← MODIFIED (synchronous initial state so first render is correct — no wrong-tree flash)
└── pages/
    └── TodoPage.tsx                           ← MODIFIED (revert CSS-split: JS branch on useIsMobile(); freeze branch during active drag so rotation mid-drag doesn't unmount droppables)
```

No new files. No dependency changes.

## Key pseudocode

### TodoCard.tsx

Add touch CSS to the outer `motion.div` AND to the two child icon buttons (pin + complete) since iOS can resolve touch to a child element before the parent's `touch-action: none` applies.

```tsx
<motion.div
  ref={isDragOverlay ? undefined : setNodeRef}
  style={{
    ...(isDragOverlay ? undefined : style),
    WebkitTouchCallout: 'none',  // iOS: suppress Copy/Look Up/Translate menu
    WebkitUserDrag: 'none',      // iOS: suppress native drag-image gesture that can also trigger callout
  }}
  {...(isDragOverlay ? {} : attributes)}
  {...(isDragOverlay ? {} : listeners)}
  layout={!isDragOverlay}
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: isCompleted ? 0.5 : isDragging ? 0.4 : 1, y: 0 }}
  className={cn(
    'relative cursor-grab rounded-lg border border-l-[3px] bg-card p-3 shadow-sm transition-shadow hover:shadow-md max-md:pr-8',
    'touch-none select-none',  // disable browser touch gestures + text selection on card
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
    className={cn(
      "absolute right-1 top-1 h-6 w-6 max-md:h-11 max-md:w-11 max-md:right-0 max-md:top-0 max-md:p-[10px] max-md:min-h-0",
      "touch-none select-none"   // <-- new
    )}
    onClick={handleTogglePin}
  >…</Button>
  …
  <Button
    variant="ghost"
    size="icon"
    className={cn(
      "h-6 w-6 hover:text-green-600 max-md:h-11 max-md:w-11 max-md:p-[10px] max-md:min-h-0",
      "touch-none select-none"   // <-- new
    )}
    onClick={handleComplete}
  >…</Button>
</motion.div>
```

Notes:
- `touch-none` on desktop is a no-op for mouse-wheel/trackpad (touch-action only affects touch devices).
- `{ ...undefined }` is legal in JS and produces `{}`, so spreading the conditional style is safe.
- Tradeoff acknowledged: with `touch-action:none` on cards, a user who rests their finger on a card cannot start a page scroll from there. They must start scroll from the gaps between cards, the accordion row headers (which are `<button>` not draggable), or the page padding. Acceptable given cards occupy a modest portion of the viewport.

### use-mobile.tsx

Initialize synchronously so the first render is correct:

```tsx
import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // Synchronous init — avoids a wrong-tree first render + stale droppable registrations.
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
```

### TodoPage.tsx

Revert the CSS-split. Import `useIsMobile`, and branch on `isMobile`. **Freeze the branch during an active drag** so a mid-drag rotation doesn't unmount the currently-dragged droppable tree:

```tsx
import { useIsMobile } from '@/hooks/use-mobile';

// inside TodoPage()
const currentIsMobile = useIsMobile();
// Snapshot at drag-start so the tree doesn't remount if the user rotates mid-drag.
const [frozenIsMobile, setFrozenIsMobile] = useState<boolean | null>(null);
const isMobile = frozenIsMobile ?? currentIsMobile;

// wire into the existing handleDragStart / handleDragEnd:
function handleDragStart(event: DragStartEvent) {
  setFrozenIsMobile(currentIsMobile);  // freeze
  setActiveDragId(event.active.id as string);
}
function handleDragEnd(event: DragEndEvent) {
  // …existing logic…
  setActiveDragId(null);
  setFrozenIsMobile(null);  // unfreeze
}

// ...inside the Tasks view after Unassigned drop zone...

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
        …empty state…
      </div>
    )}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <AnimatePresence>
        {columns.map(col => { …existing desktop column mapping… })}
      </AnimatePresence>
    </div>
  </>
)}
```

Removing both the `md:hidden` wrapper and the `hidden md:grid` wrapper from the prior plan. Only one tree mounts — on desktop the accordion never mounts → no hidden `useDroppable` registrations → normal wheel scroll restored.

The empty state ("No columns yet") currently lives inside the grid branch. Move the mobile empty state into `TodoMobileAccordion` itself (already done in current code — `columns.length === 0` check returns a friendly empty state). For the desktop grid, keep the existing empty state inside the `!isMobile` branch.

## Tasks (in implementation order)

1. **Edit `src/hooks/use-mobile.tsx`** — change `useState` initializer to a function that reads `window.innerWidth < 768` synchronously (with `typeof window !== 'undefined'` guard). Return raw `isMobile` (no `!!`). Keep the resize listener.
2. **Edit `src/components/todo/TodoCard.tsx`** —
   - Outer `motion.div`: add `touch-none select-none` to the className; add `WebkitTouchCallout: 'none'` and `WebkitUserDrag: 'none'` to the inline `style`.
   - Pin `<Button>`: append `touch-none select-none` to its className.
   - Complete `<Button>`: append `touch-none select-none` to its className.
3. **Edit `src/pages/TodoPage.tsx`** —
   - Add import: `import { useIsMobile } from '@/hooks/use-mobile';`
   - Add `useState` for `frozenIsMobile`; compute effective `isMobile = frozenIsMobile ?? currentIsMobile`.
   - Update `handleDragStart` / `handleDragEnd` to set/clear the freeze.
   - Replace the `md:hidden` and `hidden md:grid` wrappers with a single JS branch: `{isMobile ? <TodoMobileAccordion … /> : (<>…desktop grid + empty state…</>)}`. Keep the existing "No columns yet" empty state inside the desktop branch only.
4. **Verify via Chrome DevTools MCP** (see below).
5. **Re-run typecheck + lint**: `./node_modules/.bin/tsc --noEmit` and `npm run lint`.
6. **Fallback check (only if bug 3 persists)**: set `autoScroll={false}` on the `DndContext`, retest, commit if it fixes it.
7. **Commit + push to main-9 and fast-forward to main** (user has pre-approved pushes for this branch).

## Verification via Chrome DevTools MCP

Dev server runs at `http://localhost:8081/`. Browser is already connected. Important: synthetic `WheelEvent` and `TouchEvent` dispatch has significant caveats (noted by both reviewers). We will primarily verify by **inspecting DOM/CSS state** (fast, reliable) and **taking screenshots**. The user will be the final manual verifier for real wheel/touch behavior.

**Pre-flight:**
1. `list_pages` → pick or open `http://localhost:8081/todos`.
2. Ensure the user is logged in (prior session persists via localStorage or cookies — if not, pause and ask the user to log in once).

**Desktop CSS check (bug 3):**
3. `emulate viewport: 1280x800x1` (desktop).
4. `navigate_page` to `/todos`.
5. `evaluate_script`: return `document.querySelectorAll('[id^="todo-row-panel-"]').length` — expect `0` (no accordion rows should exist on desktop). If > 0, Fix B is not applied.
6. `evaluate_script`: return `getComputedStyle(document.querySelector('main')).overscrollBehaviorY` — expect `'contain'` (keep confirms).
7. `take_screenshot fullPage:true` — save desktop layout for visual regression check.
8. `list_console_messages` — assert no @dnd-kit warnings.
9. **Manual verification handed to user**: "Open `/todos` on desktop and scroll the page with your mouse wheel. Confirm it works."

**Mobile CSS check (bugs 1, 2, text-highlight):**
10. `emulate viewport: 440x956x3,mobile,touch` (iPhone 17 Pro Max).
11. `navigate_page reload:true` to `/todos`.
12. `evaluate_script`: assert each draggable card's computed style — `getComputedStyle(document.querySelector('.cursor-grab')).touchAction === 'none'` and `.userSelect === 'none'` and `.webkitTouchCallout === 'none'`.
13. `evaluate_script`: assert desktop grid is NOT mounted — `document.querySelectorAll('.grid.grid-cols-1').length === 0` (or similar structural check — desktop grid has unique class signature).
14. `evaluate_script`: assert accordion rows exist — `document.querySelectorAll('[id^="todo-row-panel-"]').length` or buttons with `aria-expanded` should be > 0.
15. `take_screenshot fullPage:true` at 440×956.
16. `emulate viewport: 375x667x3,mobile,touch` (iPhone SE).
17. `evaluate_script`: assert no horizontal overflow — `document.documentElement.scrollWidth <= window.innerWidth + 1` (1px tolerance).
18. `take_screenshot fullPage:true` at 375×667.
19. `list_console_messages` — assert no errors.
20. **Manual verification handed to user**: "On your iPhone, go to `/todos`. Create a new unassigned task. Long-press it and drag over a contact row. Confirm: (a) no callout menu, (b) no text highlight on 'normal', (c) row auto-opens after ~700ms, (d) drop assigns the task."

Where synthetic events can help (limited): we'll dispatch a basic `touchstart` on a card and inspect `window.getSelection().toString()` to confirm no text selection occurs, as a spot-check for bug 2. But the authoritative drag test is manual.

If any CSS-level verification fails, stop and iterate before commit.

## Deprecated / removed code

- The CSS-split blocks `<div className="md:hidden">` and `<div className="hidden md:grid …">` around the accordion and desktop grid — removed in favor of a JS conditional. Not a separate cleanup step; happens as part of Task 2.

## Known gotchas

- **`touch-none` on desktop**: Safe — `touch-action` only affects touchscreens and pointer devices that emit touch events. Normal mouse wheel and trackpad scroll on desktop are unaffected.
- **`useIsMobile()` first-render flash**: On a real iPhone, the hook initializes to `false` (since `!!undefined === false`) for one render before the `useEffect` fires and sets it correctly. User sees the desktop grid for ~1 frame. Acceptable per the brief discussion. If it turns out to be visible, we can fix later with a `useSyncExternalStore`-based media-query hook that reads the correct value synchronously on first render.
- **`WebkitTouchCallout` React prop name**: Must be camelCase. Inline-style prop keys use JS naming. Non-iOS browsers silently ignore it.
- **`select-none` on the card root also prevents selecting the title text**: That's fine — the `TodoDetailSheet` (opens on click) is where the user would want to read/select text, and that sheet's content isn't affected by the card's `select-none`.
- **Motion.div + style merge**: The existing `style` prop is `transform? … : undefined`. When `!isDragOverlay`, merge: `style={{ ...style, WebkitTouchCallout: 'none' }}` — and since `style` can be `undefined`, use `{ ...(style ?? {}), WebkitTouchCallout: 'none' }` to avoid spreading undefined (which is legal but unclean).

## Validation gates

- `./node_modules/.bin/tsc --noEmit` — passes (pure CSS/JSX changes, no type surface changes).
- `npm run lint` — passes (no new lint rules exercised).
- Chrome DevTools MCP verification steps above — all assertions pass.
- Manual desktop test: mouse wheel scrolls `/todos` normally.
- Manual mobile test: drag an unassigned card, hold over a collapsed row, row auto-opens after 700ms, drop → todo assigned.

## Confidence: 9/10

High confidence because the root causes are well-understood (iOS text-selection hijack + hidden-droppable mount cost), the fixes are surgical (3-line CSS add + one JS conditional), and we have DevTools MCP working to verify. Half-point uncertainty on bug 3 — if the scroll regression persists after removing the hidden accordion mounts, the next suspect is `autoScroll` or the `overscroll-y-contain` on `<main>`, both easy to pivot to.
