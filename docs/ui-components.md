# UI Components & Layout

> shadcn/ui component library, app layout shell, sidebar navigation, and custom components.

**Status:** Active
**Last Updated:** 2026-03-22
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [architecture.md](./architecture.md)

---

## Overview

The UI layer consists of three parts:
1. **shadcn/ui library** — 48 pre-built Radix UI-based primitives in `src/components/ui/`
2. **Layout shell** — AppLayout, AppSidebar, NavLink providing the app's structural frame
3. **Feature components** — Components specific to features (currently only CampaignAIChat)

All components use Tailwind CSS utility classes and the `cn()` merge utility. Colors are driven by CSS custom properties defined in `src/index.css`.

---

## File Map

| File | Purpose |
|------|---------|
| `src/components/AppLayout.tsx` | Main layout wrapper (sidebar + header + content outlet) |
| `src/components/AppSidebar.tsx` | Collapsible navigation sidebar with branding and logout |
| `src/components/NavLink.tsx` | Active-aware navigation link wrapper |
| `src/components/outreach/CampaignAIChat.tsx` | AI chat for campaign creation (documented in [outreach.md](./outreach.md)) |
| `src/components/ui/*.tsx` | 48 shadcn/ui primitive components |
| `src/lib/utils.ts` | `cn()` class merge utility |
| `src/index.css` | CSS custom properties (design tokens) |

---

## Layout Shell

### AppLayout (`src/components/AppLayout.tsx`)

The main layout component wrapping all authenticated routes via React Router's `<Outlet />`.

**Structure:**
```
SidebarProvider
  └── div.flex.h-screen.w-full
      ├── AppSidebar
      └── div.flex-1.flex-col.min-w-0
          ├── header.h-14.border-b.flex.items-center.px-4
          │   ├── SidebarTrigger (hamburger toggle)
          │   └── Avatar (user initials, right-aligned)
          └── main.flex-1.overflow-auto
              └── <Outlet /> (page content)
```

**Key details:**
- Header height: 56px (`h-14`)
- Header is sticky/fixed at top
- Content area scrolls independently (`overflow-auto`)
- `min-w-0` on content prevents text overflow with flex layout
- User avatar shows first letter of each name word (e.g., "SC" for Sarah Chen)
- SidebarTrigger toggles sidebar collapsed/expanded state

### AppSidebar (`src/components/AppSidebar.tsx`)

Collapsible navigation sidebar using shadcn's `Sidebar` component.

**Navigation Items:**
| Title | URL | Icon | Notes |
|-------|-----|------|-------|
| Dashboard | `/` | LayoutDashboard | `end` prop for exact match |
| Leads | `/leads` | Users | — |
| Lead Generator | `/generator` | Sparkles | — |
| Outreach | `/outreach` | Mail | — |
| Pipeline | `/pipeline` | Kanban | — |
| Settings | `/settings` | Settings | — |

**Branding:**
- Blue square with "I" lettermark
- "IntegrateAPI" text (hidden when collapsed)

**Footer:**
- User name and role (hidden when collapsed)
- "Sign out" button — calls `logout()` from AuthContext

**Collapse behavior:**
- `collapsible="icon"` — collapses to icon-only mode
- Text labels hidden when `state === 'collapsed'`
- Logout button changes from labeled to icon-only

### NavLink (`src/components/NavLink.tsx`)

Wrapper around React Router's `NavLink` that adds:
- `activeClassName` prop — applied when route is active
- `pendingClassName` prop — applied during navigation transition
- Uses `cn()` for proper Tailwind class merging (prevents conflicts)
- Supports `forwardRef` for DOM element access

**Props:**
```typescript
interface NavLinkCompatProps extends Omit<NavLinkProps, "className"> {
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
}
```

---

## shadcn/ui Component Library

48 components installed in `src/components/ui/`. All are stock shadcn/ui implementations unless noted.

### Actively Used in Current Features

| Component | Used In |
|-----------|---------|
| `button` | Every page |
| `card` (Card, CardContent, CardHeader, CardTitle, CardDescription) | Every page |
| `badge` | Dashboard, Leads, Pipeline, Settings, Outreach |
| `input` | Login, Leads, Outreach, Lead Generator, Settings |
| `textarea` | Lead Detail, Outreach |
| `select` (Select, SelectContent, SelectItem, SelectTrigger, SelectValue) | Leads, Outreach, Lead Detail |
| `table` (Table, TableBody, TableCell, TableHead, TableHeader, TableRow) | Leads, Outreach, Lead Generator |
| `tabs` (Tabs, TabsContent, TabsList, TabsTrigger) | Outreach |
| `checkbox` | Leads, Outreach |
| `scroll-area` | Outreach (inbox) |
| `sidebar` (Sidebar, SidebarContent, SidebarGroup, etc.) | AppSidebar |
| `tooltip` (TooltipProvider) | App.tsx (global) |
| `toast` + `toaster` | App.tsx (global), Outreach |
| `sonner` | App.tsx (global) |
| `avatar` | AppLayout (header) |
| `separator` | Various |
| `label` | Settings |
| `popover` | Outreach (compose lead search) |

### Installed but Not Currently Used

These components are available for future features:

| Component | Potential Use |
|-----------|---------------|
| `accordion` | FAQ, expandable sections |
| `alert` | Warning/info banners |
| `alert-dialog` | Confirmation dialogs (delete, destructive actions) |
| `aspect-ratio` | Image/media containers |
| `breadcrumb` | Page navigation trails |
| `calendar` | Date picking (deal close dates, scheduling) |
| `carousel` | Image galleries |
| `chart` | Chart wrapper (currently using Recharts directly) |
| `collapsible` | Expandable sections |
| `command` | Command palette (Cmd+K) |
| `context-menu` | Right-click menus |
| `dialog` | Modal dialogs |
| `drawer` | Bottom/side drawers (mobile) |
| `dropdown-menu` | Action menus |
| `form` | react-hook-form integration |
| `hover-card` | Hover previews |
| `input-otp` | OTP/verification codes |
| `menubar` | Menu bars |
| `navigation-menu` | Complex navigation |
| `pagination` | Paginated lists |
| `progress` | Progress bars |
| `radio-group` | Radio selections |
| `resizable` | Resizable panels |
| `sheet` | Slide-over panels |
| `skeleton` | Loading skeletons |
| `slider` | Range sliders |
| `switch` | Toggle switches |
| `toggle` / `toggle-group` | Toggle buttons |

---

## Utility: `cn()` — `src/lib/utils.ts`

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Combines `clsx` (conditional classes) with `tailwind-merge` (resolves conflicting Tailwind classes). Used in every component.

---

## Design Token System — `src/index.css`

All colors defined as CSS custom properties in HSL format (without `hsl()` wrapper — Tailwind adds it).

### Key Color Variables

**Light mode (`:root`):**
| Variable | Value (HSL) | Purpose |
|----------|-------------|---------|
| `--background` | `0 0% 100%` | Page background |
| `--foreground` | `222.2 84% 4.9%` | Primary text |
| `--primary` | `217.2 91.2% 59.8%` | Brand blue |
| `--destructive` | `0 72% 51%` | Red for dangerous actions |
| `--muted` | `210 40% 96%` | Muted backgrounds |
| `--sidebar-background` | `220 20% 12%` | Dark sidebar bg |
| `--sidebar-foreground` | `214 32% 96%` | Light sidebar text |
| `--sidebar-primary` | `217.2 91.2% 59.8%` | Sidebar accent (same blue) |

**Dark mode (`.dark`):**
- Inverted light/dark values
- Accessible contrast ratios maintained

### Status Color System

Used consistently across Dashboard, Leads, Outreach, and Pipeline:

| Status | Badge Class | Chart HSL |
|--------|-------------|-----------|
| Cold | `bg-blue-100 text-blue-700` | `217.2 91.2% 59.8%` |
| Lukewarm | `bg-amber-100 text-amber-700` | `38 92% 50%` |
| Warm | `bg-orange-100 text-orange-700` | `25 95% 53%` |
| Dead | `bg-red-100 text-red-700` | `0 72% 51%` |

---

## Known Limitations & TODOs

- `App.css` contains unused Vite boilerplate styles
- No dark mode toggle in the UI (CSS variables are defined but `.dark` class is never applied)
- Toast system is dual (Sonner + shadcn Toaster) — could be consolidated
- No loading skeletons used (Skeleton component available but unused)
- No confirmation dialogs (AlertDialog available but unused)
- No command palette (Command component available but unused)
- No responsive drawer for mobile sidebar (Drawer available but unused)
- Sidebar color scheme is hardcoded in CSS variables (not themeable via UI)
- Status colors duplicated across multiple page files (not centralized)

---

## Future Considerations

- Add dark mode toggle (UI control to add/remove `.dark` class on `<html>`)
- Consolidate toast system to a single provider (Sonner recommended as simpler)
- Centralize status color config into a shared constant (currently duplicated in DashboardPage, LeadsPage, LeadDetailPage, OutreachPage)
- Use Skeleton components for loading states when backend is added
- Use AlertDialog for destructive action confirmations (delete lead, remove team member)
- Consider adding Command palette (Cmd+K) for power users
- Use Sheet/Drawer for mobile sidebar experience

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
