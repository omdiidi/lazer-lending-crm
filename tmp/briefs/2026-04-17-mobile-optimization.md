# Brief: Mobile optimization (iPhone 17 Pro Max → iPhone SE)

## Why
The CRM is desktop-first today. On mobile, buttons are under-sized for touch, reaching the To-Do tab takes two taps (hamburger → tab), and the To-Do page's horizontal person-columns don't fit a phone screen. The user wants the app to feel native and fast on iPhone — especially the To-Do workflow, which is the primary mobile use case.

## Context
- **Stack**: React 18 + Vite + Tailwind + shadcn/ui + React Router v6. TanStack Query. Supabase backend. Framer Motion for animation. Icons via lucide-react.
- **Shell**: `src/components/AppLayout.tsx` wraps `SidebarProvider` + `AppSidebar.tsx`. Top bar currently holds `SidebarTrigger` + user avatar.
- **Sidebar tabs** (8): Dashboard, To-Do, Leads, Lead Generator, Outreach, Pipeline, Settings, Staff (admin-only).
- **Mobile detection**: `src/hooks/use-mobile.tsx` — 768px breakpoint. Sidebar already becomes a Sheet overlay below 768.
- **Buttons**: `src/components/ui/button.tsx` shadcn CVA — sizes `sm=h-9 (36px)`, `default=h-10 (40px)`, `lg=h-11 (44px)`, `icon=h-10 w-10 (40px)`. Apple HIG minimum is 44px, so `sm` and `icon` are under-sized for touch.
- **To-Do page**: `src/pages/TodoPage.tsx` uses `@dnd-kit/core` v6.3.1 with `PointerSensor` (distance:8) + `pointerWithin` collision. Framer Motion animates columns/cards. DragOverlay shows scaled preview. No auto-scroll, no long-press, no spring-load on hover.
- **Design language**: shadcn defaults, tailwind tokens, framer-motion for animation — keep using these, don't introduce new libraries.

## Decisions

- **Scope is mobile-only polish + To-Do redesign + one top-bar button** — reasoning: user explicitly narrowed scope from an earlier tab-pattern discussion to "keep it simple, just make mobile work well."
- **Top bar adds a single "To-Do" button on mobile** (hidden on ≥768px) that routes to `/todos`. Existing hamburger sidebar stays as the full nav. — reasoning: user said "that's the only one that matters"; avoids the complexity of a tab bar for 8 routes.
- **Touch targets: bump mobile to ≥44px** — on mobile breakpoint, `Button sm` effectively becomes `h-11`; icon buttons min 44×44. Keep desktop density unchanged. — reasoning: Apple HIG; `sm` at 36px is the main offender.
- **To-Do mobile layout: accordion of person rows** — each person is a condensed row (avatar + name + task count badge). Tap → one-at-a-time accordion expands with Framer Motion, revealing the existing task list UI from desktop. Unassigned staging area sits at the top. — reasoning: user wants to "see more at once"; one-at-a-time keeps the phone screen focused.
- **Spring-loaded drop on drag-hover** — while dragging a task card, hovering over a collapsed person row for **700ms** auto-expands that row (same animation as tap), letting the user drop into the open list. Leaving the row before 700ms cancels. — reasoning: user-requested "intended period of time" pattern; 700ms matches macOS Finder / iOS.
- **Drag activation on mobile** — keep `@dnd-kit` but add a `TouchSensor` with `delay:250, tolerance:5` so page scroll isn't hijacked, and keep `PointerSensor` for mouse. Enable `autoScroll` for edge auto-scroll. — reasoning: 8px-distance alone conflicts with vertical scroll on touch.
- **Condensed row shows task count, not task preview** — reasoning: cleaner; previews crowd a phone row.
- **Design language: shadcn + tailwind + framer-motion, no new libs** — reasoning: user asked to follow existing design language.

## Rejected Alternatives
- **Horizontal scrollable top tab bar (all 8 tabs)** — rejected: user wants only the single To-Do button.
- **Bottom tab bar / iOS-native pattern** — rejected: same reason; over-scoped.
- **Springboard grid landing page** — rejected: same reason.
- **Vertical stack of person columns (no accordion)** — rejected: takes too much vertical space; user explicitly wants "see more at once."
- **Show 1–2 task title previews in the condensed row** — rejected in favor of a count badge for cleanliness.
- **Multiple accordion rows open simultaneously** — rejected; one-at-a-time is cleaner on a phone.
- **Global `sm` button size bump (desktop + mobile)** — rejected; would reduce desktop density. Scope the bump to mobile breakpoint only.

## Direction
Ship a mobile-only polish pass: (1) top bar gets a visible "To-Do" shortcut button, (2) all buttons/inputs/dialogs meet 44px touch targets and fit iPhone SE → 17 Pro Max widths without overflow, (3) the To-Do page on mobile becomes a one-at-a-time accordion of persons with a 700ms spring-loaded drag-drop, and (4) @dnd-kit gets a proper TouchSensor + autoScroll so dragging and page-scrolling coexist. Keep the design language (shadcn + tailwind + framer-motion) and verify in Chrome DevTools MCP at 440pt and 375pt viewports before closing.
