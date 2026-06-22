# OrgSight Design System & Theme Migration Guide

> **Status:** Phase 1 complete (Tailwind `am`/`brand` values remapped to blue).  
> Phase 2 (shell, headers, emerald cleanup, inline hex) — pending.

---

## Design Philosophy

OrgSight uses a **blue-centric, enterprise-grade** theme — professional and data-focused, aligned with other A&M apps (Spend Dashboard, Spend Impact). The palette is built on deep navy/mid-blue primaries, icy blue page surfaces, glassmorphism-style cards, blue-tinted shadows/borders, and vivid semantic colors for status. **Secondary accents** (amber, coral, teal, violet) are used dynamically for CTAs, chart series, and feature highlights.

**Org chart node cards are out of scope** — they keep the existing navy/gold `orgChartTheme.js` look.

---

## Primary Color Palette — Blue (Brand)

| Token | Hex | Usage |
|---|---|---|
| `brand-50` / `am-50` | `#eaf3ff` | Page tint, soft surfaces, table zebra, chip backgrounds |
| `brand-100` / `am-100` | `#dbeafe` | Card borders, focus halo, dividers |
| `brand-200` / `am-200` | `#74a9e7` | Hover accents, progress shimmer, scrollbar |
| `brand-300` / `am-300` | `#5a93d5` | Secondary interactive mid-step |
| `brand-400` / `am-400` | `#315f9b` | Eyebrows, section labels, table headings |
| `brand-500` / `am-500` | `#155bb2` | **Primary brand** — buttons, links, focus rings, active tabs |
| `brand-600` / `am-600` | `#0a3f86` | Primary hover/pressed, **app headers**, dark surfaces |
| `brand-700` / `am-700` | `#0f2e5c` | Deep accent, modal overlay base |
| `brand-800` / `am-800` | `#0f172a` | Primary text on light surfaces |
| `brand-900` / `am-900` | `#0a1628` | Deepest shade (optional) |

> **Note:** `am-*` Tailwind classes currently map to the same blue values as `brand-*` (Phase 1). Long-term: rename all `am-*` → `brand-*` and remove the `am` key.

---

## Secondary Accents (Dynamic)

Use contextually — no single locked-in secondary. Matches Spend app patterns.

### Amber (default CTA accent — Custom Export style)

| Token | Hex | Usage |
|---|---|---|
| `accent-50` | `#fffbeb` | Soft tint backgrounds |
| `accent-100` | `#fef3c7` | Chips, alert backgrounds |
| `accent-400` | `#f7a928` | Hover, chart highlights |
| `accent-500` | `#ed8f12` | **Primary accent** — export CTAs, promoted badges |
| `accent-600` | `#d97706` | Pressed / dark hover |

### Coral, Teal, Violet (charts & feature badges)

| Scale | Hex (500) | Usage |
|---|---|---|
| `coral-500` | `#f97316` | Warm alternative CTA |
| `teal-500` | `#14b8a6` | Chart series, info accents |
| `violet-500` | `#8b5cf6` | AI / admin / premium features |

**Accent vs warning:** Both can use amber hue — differentiate by **treatment**:
- **Accent:** solid fill button (`bg-accent-500 text-white`)
- **Warning:** soft panel (`bg-accent-50 border-accent-200` + icon)

---

## Background & Surfaces

| Token | Value | Usage |
|---|---|---|
| Page gradient | `radial-gradient(circle at top left, rgba(21,91,178,0.12), transparent 40%), linear-gradient(135deg, #f2f6ff 0%, #f8fbff 50%, #eaf3ff 100%)` | App shell |
| Login gradient | `linear-gradient(135deg, #0a3f86 0%, #155bb2 55%, #315f9b 100%)` | Login left panel |
| `surface-soft` | `#f8fbff` | Empty states, dropzones |
| `surface-card` | `rgba(255,255,255,0.98)` | Cards, modals |
| Header | `bg-brand-600` + `text-white` | Top nav on all main pages |

### Shadows (blue-tinted)

| Token | Value |
|---|---|
| `shadow-card` | `0 1px 4px rgba(15, 46, 92, 0.06)` |
| `shadow-panel` | `0 4px 12px rgba(15, 46, 92, 0.08)` |
| `shadow-modal` | `0 12px 28px rgba(13, 83, 170, 0.16)` |
| `shadow-float` | `0 30px 60px rgba(15, 46, 92, 0.25)` |

---

## Text Colors

| Role | Color | Tailwind |
|---|---|---|
| Primary text | `#0f172a` | `text-brand-800` / `text-slate-900` |
| Secondary / muted | `#64748b` | `text-slate-500` |
| Table cells | `#475569` | `text-slate-600` |
| Eyebrows / headings | `#315f9b` | `text-brand-400` |
| On dark surfaces | `#ffffff` | `text-white` |
| On dark muted | `#dbeafe` | `text-brand-100` |

---

## Semantic / Status Colors

| Status | Foreground | Background | Border |
|---|---|---|---|
| Success | `#16b867` | `#ecfdf5` | `rgba(22,184,103,0.3)` |
| Success dark | `#0e9f59` | — | — |
| Warning | `#ed8f12` | `#fffbeb` | `rgba(237,143,18,0.3)` |
| Error | `#ec3f4f` | `#fef2f2` | `rgba(236,63,79,0.3)` |
| Error dark | `#d82437` | — | — |
| Info | `#155bb2` | `#eaf3ff` | `#dbeafe` |

**Brand highlights** (Active project, row accent) → use `brand-500` / `brand-50`, not emerald.  
**True success feedback** (validation passed, run complete) → can keep semantic green.

---

## Typography

| Role | Font | Weight | Tailwind |
|---|---|---|---|
| Body | **Inter** | 400–600 | `font-sans` |
| Display / headings | **Manrope** | 600–800 | `font-display` |
| Section eyebrows | Manrope | 600 | `font-display text-brand-400 uppercase tracking-wide text-xs` |

Load in `index.html`:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet" />
```

---

## Component Recipes

| Component | Classes |
|---|---|
| App header | `bg-brand-600 text-white border-b border-brand-700` |
| Primary button | `bg-brand-500 hover:bg-brand-600 text-white shadow-sm focus:ring-2 focus:ring-brand-500` |
| Accent CTA | `bg-accent-500 hover:bg-accent-600 text-white shadow-sm` |
| Secondary button | `border border-brand-500 text-brand-600 hover:bg-brand-50` |
| Ghost (on dark header) | `border border-white/30 text-white hover:bg-white/10` |
| Input | `border-gray-300 focus:ring-2 focus:ring-brand-500 focus:border-brand-500` |
| Card | `bg-white border border-brand-100 rounded-xl shadow-card` |
| Table header | `bg-brand-50 text-brand-700 text-xs uppercase` |
| Active tab / nav | `bg-brand-500 text-white` or `border-brand-500 text-brand-600 bg-brand-50` |
| Modal overlay | `bg-brand-800/30 backdrop-blur-sm` |
| Spinner | `border-brand-100 border-t-brand-500 rounded-full animate-spin` |
| Page shell | `bg-page-gradient min-h-screen` |

---

## Migration Status

### Phase 1 — Done

- [x] Remap `am.*` values to OrgSight blue in `tailwind.config.js`
- [x] Keep `brand.*` aligned with same hex values
- [x] All existing `am-*` Tailwind classes render blue (buttons, focus rings, spinners)

### Phase 2 — Pending

#### Layer 1: Foundation (4 files)

| File | Changes |
|---|---|
| `tailwind.config.js` | Add `accent`, `coral`, `teal`, `violet`, semantic colors, `surface`, `boxShadow`, `backgroundImage` (page + login gradients), `fontFamily.display` |
| `index.html` | Add Manrope font |
| `src/index.css` | CSS variables, `:root` Inter + `#0f172a`, utility classes (`.bg-page`, `.app-header`, `.btn-primary`, `.btn-accent`, `.card`, `.loader-spinner`), scrollbar |
| `src/theme/tokens.js` | **New** — shared JS tokens for inline-style components |

#### Layer 2: App shell — headers & backgrounds (6 files)

| File | Changes |
|---|---|
| `src/App.jsx` | Login gradient → blue; loading screen → page gradient |
| `src/pages/ProjectSelector.jsx` | Navy header; page gradient; logo/text on dark header |
| `src/pages/ProjectWorkspace.jsx` | Navy header; page gradient; breadcrumb on dark header |
| `src/pages/ChangePassword.jsx` | Page gradient |
| `src/pages/admin/AdminLayout.jsx` | Navy header; nav active → brand (not amber); page gradient |
| `src/components/Login.jsx` | Optional `font-display` on title |

**Header pattern:**

```
bg-brand-600 text-white border-b border-brand-700
Logo: text-white
Links: text-brand-100 hover:text-white
```

#### Layer 3: Emerald/green highlights → brand (14 files)

| File | Changes |
|---|---|
| `ProjectSelector.jsx` | Active stat card, row accent bar, StatusBadge → `brand-*` |
| `Hierarchy.jsx` | Green gradient buttons → `bg-brand-500`; success panels |
| `Validate.jsx` | Same |
| `Crosstab.jsx` | Same |
| `Cleanup.jsx` | Success panels |
| `FilterErrors.jsx` | Success panels |
| `Upload.jsx` | Green accents → brand |
| `FormulaEditor.jsx` | Green save button → brand |
| `ExportExcel.jsx` | Green export card → brand or accent |
| `ProjectWorkspace.jsx` | Module checkmarks → brand |
| `UploadAndPrepare.jsx` | Flag row OK borders (optional) |
| `CompletenessHeatmap.jsx` | Threshold colors (optional — keep semantic) |
| `SpansLayers.jsx` | Neutral severity → brand |
| `admin/UserManagement.jsx` | Role badges → brand / accent / violet |

#### Layer 4: Loaders (unify)

| File | Changes |
|---|---|
| `ActiveDatasetDropdown.jsx` | `#01244a` → brand-600; `#c5a84a` → accent-500 |
| `SavedDatasetPicker.jsx` | Hardcoded navy hex → brand |
| All `border-t-am-500` spinners | Already blue; optional `.loader-spinner` utility |

#### Layer 5: Hardcoded hex → tokens (4 files)

| File | In scope |
|---|---|
| `ActiveDatasetDropdown.jsx` | Yes |
| `orgchart/SavedDatasetPicker.jsx` | Yes (picker UI only) |
| `ActivityAnalysis.jsx` | Yes — replace `C` object with `tokens.js` |
| `DataSourceSelector.jsx` | Yes — constants + promoted badge |
| `App.jsx` | Yes — login gradient |

#### Layer 6: Optional cleanup

- Rename all `am-*` → `brand-*` across ~27 files
- Remove `am` key from `tailwind.config.js`

#### Layer 7: Card/border/typography polish

- `border-gray-200` → `border-brand-100` on cards
- Table headers → `bg-brand-50 text-brand-700`
- Export CTAs → `bg-accent-500`
- Empty states → `bg-surface-soft` (`#f8fbff`)

---

## Out of Scope (Do Not Change)

Org chart node cards and all files using `orgChartTheme.js` / `AM` object:

```
src/components/orgchart/orgChartTheme.js
src/components/orgchart/OrgNodeCard.jsx
src/components/OrgChart.jsx
src/components/orgchart/OrgImpactStrip.jsx
src/components/orgchart/OrgCompareModal.jsx
src/components/orgchart/OrgScenarioBar.jsx
src/components/orgchart/ValidationPanel.jsx
src/components/orgchart/OrgDetailPanel.jsx
src/components/orgchart/ScenarioCreateModal.jsx
src/components/orgchart/PhasingView.jsx
src/components/orgchart/OrgMoveConfirmModal.jsx
src/components/orgchart/ValidationSidebar.jsx
src/components/orgchart/OrgActivityPanel.jsx
src/components/orgchart/BulkActionBar.jsx
src/components/orgchart/OrgAddChildModal.jsx
src/components/orgchart/RateCardModal.jsx
```

---

## Execution Order

```
Step 1   tailwind.config.js (expand) + index.html + index.css + src/theme/tokens.js
Step 2   App.jsx (login + loader)
Step 3   ProjectSelector.jsx (header + page + emerald → brand)
Step 4   ProjectWorkspace.jsx (header + page + sidebar)
Step 5   AdminLayout.jsx + admin pages
Step 6   ChangePassword.jsx
Step 7   ActiveDatasetDropdown.jsx + SavedDatasetPicker.jsx
Step 8   Green gradient buttons sweep
Step 9   ActivityAnalysis.jsx
Step 10  Card/border/typography polish
Step 11  Optional: am-* → brand-* rename
```

---

## Open Design Decisions

| Question | Options |
|---|---|
| Active project status badge | Blue (`brand`) vs keep green (semantic healthy) |
| Success result panels after Run/Validate | Light green (semantic) vs `brand-50` (full blue) |
| Which buttons get accent orange? | Suggest: Export/Custom = `accent-500`; Open/Submit = `brand-500` |
| Online/live dot on workspace | Green (live) vs brand |

---

## Reference: Spend Dashboard Alignment

| Spend app element | OrgSight equivalent | Color |
|---|---|---|
| Dark navy header bar | Project / workspace / admin header | `brand-600` |
| Active tab pill | Module nav active state | `brand-500` / `brand-600` |
| Primary chart bars | Analysis charts | `brand-500` |
| Custom Export button (orange) | Export PPT, promoted scenario | `accent-500` |
| Completed badge (green) | Validation pass, run success | `success` |
| Multi-series charts | Activity Analysis, heatmaps | blue + teal + coral + violet + green |

---

*Last updated: June 2025 — Phase 1 complete, Phase 2 planned.*
