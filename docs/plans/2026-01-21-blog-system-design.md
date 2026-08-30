# Blog System Design

A hand-rolled markdown-to-HTML blog system with three-column layout, inspired by makingsoftware.com.

## Goals

- Write ML engineering explorations in markdown
- Three-column layout: left nav (chapters), main content, right nav (sections)
- Hybrid typography: Cormorant Garamond body, monospace headers/nav
- Emergent chapter structure (posts uncategorized until grouped)
- Minimal dependencies, full control

## Directory Structure

```
my-website/
├── blog/
│   ├── posts/                    # Markdown files
│   │   ├── memory-bandwidth.md
│   │   └── tensor-cores.md
│   ├── chapters.json             # Chapter definitions (optional)
│   ├── build.js                  # Build script
│   └── dist/                     # Generated HTML
│       ├── index.html            # Blog index
│       ├── memory-bandwidth.html
│       └── tensor-cores.html
├── css/
│   ├── style.css                 # Existing styles
│   └── blog.css                  # Blog-specific styles
└── index.html                    # Existing homepage
```

## Markdown Format

```markdown
---
title: Why Memory Bandwidth is the Bottleneck
date: 2026-01-21
chapter: gpu-compute          # Optional
order: 1                      # Order within chapter
---

Content here. ## Headings become right-nav sections.
```

## chapters.json

```json
[
  { "id": "gpu-compute", "title": "GPU & Compute", "order": 1 }
]
```

Posts without a `chapter` field appear in "Explorations" section.

## Build Script

**Responsibilities:**
1. Read all `.md` files from `posts/`
2. Parse frontmatter (title, date, chapter) via `gray-matter`
3. Extract `## headings` for right-nav
4. Convert markdown → HTML via `marked`
5. Wrap in three-column template
6. Generate index page (posts grouped by chapter)
7. Output to `dist/`

**Dependencies:**
- `marked` — markdown to HTML
- `gray-matter` — frontmatter parsing

**Usage:**
```bash
node blog/build.js
```

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [← Back]   CHAPTER / POST TITLE                                │
├────────────┬────────────────────────────────────┬───────────────┤
│  CHAPTERS  │       MAIN CONTENT                 │  SECTIONS     │
│  ~200px    │       flexible                     │  ~150px       │
│            │                                    │               │
│  Left nav  │  Article body with headings,       │  In-page nav  │
│  with all  │  code blocks, diagrams             │  generated    │
│  chapters  │                                    │  from ##      │
│  and posts │                                    │  headings     │
└────────────┴────────────────────────────────────┴───────────────┘
```

## Typography

- **Body**: Cormorant Garamond (existing)
- **Nav, headers, code**: Monospace (JetBrains Mono or IBM Plex Mono)
- **Dividers**: `-----` as subtle horizontal rules

## Responsive Behavior

- **Desktop (>1200px)**: Full three-column
- **Tablet (800-1200px)**: Hide left nav, keep right section nav
- **Mobile (<800px)**: Single column, section nav as dropdown/hidden

## Features

- **Scroll-spy**: Current section highlights in right nav (CSS/JS)
- **Code highlighting**: Client-side highlight.js
- **Breadcrumb nav**: Chapter / Post Title at top

## Integration

Update main site nav link from Notion to `/blog/dist/index.html`.
