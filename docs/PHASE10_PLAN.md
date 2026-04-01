# Phase 10: Marketing Surface & Documentation

## Overview

Build the public-facing marketing and documentation layer for the payment orchestration platform. This phase transforms the project from an internal tool into a presentable SaaS product with a landing page, comprehensive API documentation, and a polished README.

## 10A: Landing Page

### Route Strategy

- Landing page renders at `/landing` (public route, no auth required)
- Root `/` stays as dashboard for logged-in users; redirects to `/login` for guests
- Login page gets "Learn more" link to `/landing`
- Landing page CTAs: "Get Started" → `/onboarding`, "Sign In" → `/login`, "View Docs" → `/docs`

### Sections

| # | Section | Content |
|---|---------|---------|
| 1 | Hero | Headline, subtitle, two CTA buttons, animated gradient orb background |
| 2 | Logos bar | "Trusted by leading companies" + 6 placeholder SVG logos |
| 3 | Features grid | 6 feature cards with icons: Multi-Provider Routing, Fraud Scoring, Smart Retries, Subscription Billing, Split Payments, Real-time Analytics |
| 4 | How it works | 3-step horizontal flow: Integrate → Configure → Optimize |
| 5 | Code example | Syntax-highlighted `POST /payments` example with response |
| 6 | Pricing table | Free / Starter ($49) / Growth ($199) / Enterprise (custom) |
| 7 | Dashboard preview | Static screenshots of key dashboard pages in a browser frame mockup |
| 8 | Footer | Navigation links, social icons, copyright |

### Design Requirements

- **Font pairing**: DM Sans (headings) + JetBrains Mono (code) — loaded via next/font/google
- **Background**: Subtle dot grid pattern via CSS radial-gradient
- **Gradients**: Blue-to-purple gradient accents on hero, buttons, section dividers
- **Animations**: CSS-only intersection observer fade-in via Tailwind animation utilities
- **Dark mode**: Toggle in top nav; respects system preference; persists to localStorage
- **Responsive**: Mobile-first, single-column stacking, responsive pricing cards
- **Top nav**: Sticky transparent header with logo, nav links (Features, Pricing, Docs), Sign In / Get Started buttons

### File Changes

| File | Action |
|------|--------|
| `dashboard/src/app/landing/page.tsx` | Create — full landing page (~800 lines) |
| `dashboard/src/app/shell.tsx` | Modify — add `/landing` and `/docs` to PUBLIC_ROUTES |
| `dashboard/src/app/layout.tsx` | Modify — add DM Sans + JetBrains Mono fonts |
| `dashboard/src/app/globals.css` | Modify — add light mode variables, animations, grid pattern |

## 10B: Documentation Pages

### Architecture

- All docs pages live under `/docs/*` route
- Docs layout with its own sidebar navigation (separate from dashboard shell)
- Each page is a client component with tabbed code examples
- No external markdown renderer — hand-built with Tailwind typography

### Pages

| Route | Title | Content |
|-------|-------|---------|
| `/docs` | Quick Start | 5-minute integration guide |
| `/docs/authentication` | Authentication | API keys, scopes, rate limits |
| `/docs/payments` | Payments | Create, capture, refund, cancel |
| `/docs/subscriptions` | Subscriptions | Plans, lifecycle, billing |
| `/docs/webhooks` | Webhooks | Setup, events, verification, retry |
| `/docs/fraud` | Fraud Prevention | Rules, scoring, thresholds |
| `/docs/split-payments` | Split Payments | Marketplace setup, payout config |
| `/docs/disputes` | Disputes | Lifecycle, evidence submission |
| `/docs/testing` | Testing | Sandbox, test cards, simulated events |
| `/docs/api-reference` | API Reference | Endpoint table with link to GraphQL playground |

### Code Example Format

Each page has code examples in 3 languages with a tab switcher:

```
[Node.js] [Python] [cURL]
┌─────────────────────────────┐
│ const response = await ...  │
│                             │
└─────────────────────────────┘
```

### File Changes

| File | Action |
|------|--------|
| `dashboard/src/app/docs/layout.tsx` | Create — docs layout with sidebar nav |
| `dashboard/src/app/docs/page.tsx` | Create — Quick Start |
| `dashboard/src/app/docs/authentication/page.tsx` | Create |
| `dashboard/src/app/docs/payments/page.tsx` | Create |
| `dashboard/src/app/docs/subscriptions/page.tsx` | Create |
| `dashboard/src/app/docs/webhooks/page.tsx` | Create |
| `dashboard/src/app/docs/fraud/page.tsx` | Create |
| `dashboard/src/app/docs/split-payments/page.tsx` | Create |
| `dashboard/src/app/docs/disputes/page.tsx` | Create |
| `dashboard/src/app/docs/testing/page.tsx` | Create |
| `dashboard/src/app/docs/api-reference/page.tsx` | Create |
| `dashboard/src/components/code-block.tsx` | Create — syntax-highlighted code with copy button |
| `dashboard/src/components/docs-nav.tsx` | Create — docs sidebar navigation |

## 10C: README Rewrite

### Sections

1. One-sentence description + badges (CI, TypeScript, License, Tests)
2. "Why This Exists" — portfolio story
3. Feature list with business value descriptions
4. Architecture diagram (Mermaid, updated with all Phase 1–9 components)
5. Quick Start with docker-compose
6. "Engineering Decisions" — 5 key decisions with reasoning
7. "What I'd Build Next" — product roadmap vision
8. Performance numbers from load tests
9. Test count (640 tests, 44 files)
10. Screenshots of all dashboard pages
11. Demo workflow
12. License (MIT)

### File Changes

| File | Action |
|------|--------|
| `README.md` | Rewrite — complete overhaul |
| `LICENSE` | Create — MIT license file |

## Testing Plan

- `cd dashboard && npx tsc --noEmit` — type check all new pages
- `npx tsc --noEmit` — backend type check (no backend changes expected)
- `npm test` — ensure existing tests still pass
- Manual: landing page renders without auth
- Manual: docs pages navigate correctly
- Manual: dark mode toggle works

## Dependencies

No new npm packages required. DM Sans and JetBrains Mono loaded via `next/font/google`.

## Estimated File Count

- **New files**: ~16 (1 landing, 11 docs pages, 2 components, 1 docs layout, 1 LICENSE)
- **Modified files**: ~4 (shell.tsx, layout.tsx, globals.css, README.md)
