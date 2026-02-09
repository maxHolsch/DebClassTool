# The Deliberatorium

**A collaborative sensemaking platform built on tldraw's Agent Starter Kit**

---

## The Problem

Most collaboration tools help you talk *at* each other, not *with* each other. Slack, Google Docs, discussion boards — they're all stacks of text. Readings pile up week after week, and the ideas in them never actually interface with each other or with the group's evolving understanding.

The Deliberatorium makes the **structure of disagreement visible**. AI lays down a first pass. Humans break it, reshape it, and build on top. The canvas becomes a shared artifact of how a group thinks together.

---

## What It Is

A reskinned tldraw canvas with an AI agent that generates visual diagrams from source material (readings, transcripts, audio). These diagrams become the substrate for structured deliberation — the group annotates, rearranges, and challenges the AI's synthesis, building shared understanding over time.

### Primary mode: Between classes (async)

This is where the real work happens. Students engage with the platform on their own time — reviewing AI-generated maps of the readings, annotating them, marking where they agree or disagree, and preparing for the next discussion. The canvases they build between sessions become the foundation for what happens in the room.

### Secondary mode: In-class (live, lightweight)

A single side tool during class: a **reading recommender popout** that listens to the live discussion and surfaces relevant passages from the course readings in real-time. That's it — the canvas work happens before and after class, not during.

---

## User Interface

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ┌─────────┐                                                 │
│  │  Logo   │   Weekly Prep  ·  Question Space  ·  Sketches   │
│  └─────────┘                                        ┌──────┐ │
│                                                     │ Chat │ │
│  ┌─────────────────────────────────────────────┐    │      │ │
│  │                                             │    │ Agent│ │
│  │                                             │    │ Panel│ │
│  │              tldraw Canvas                  │    │      │ │
│  │                                             │    │      │ │
│  │                                             │    │      │ │
│  │                                             │    │      │ │
│  │                                             │    │      │ │
│  └─────────────────────────────────────────────┘    └──────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Status bar: 4 collaborators online · Last saved 2m ago  ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Top Navigation

A tab bar that switches between canvases:

- **Weekly Prep** — The main workspace. A new canvas each week, pre-populated by the Discussion Prep Agent with fault lines from that week's readings. This is where the group does most of their async work.
- **Question Space** — A persistent canvas that accumulates questions and responses across the whole semester.
- **Sketches** — A dropdown or sub-nav listing individual reading/transcript sketch files. Reference material, not primary workspace.

### Agent Chat Panel (Right Side)

The tldraw agent kit's built-in chat panel, where students can:

- Ask the agent to generate or modify diagrams
- Trigger specific agent modes ("Map this reading", "Find the tensions", "Suggest pairings for next class")
- See the agent's thinking process as it streams

### Reading Recommender (Popout Window)

A floating popout window (not a sidebar — it shouldn't compete with the canvas for space). Used during in-class sessions:

- Launches from a button in the nav bar
- Connects to a live audio transcription stream (AssemblyAI)
- Displays relevant reading passages in real-time as the discussion unfolds
- Compact card-based UI: passage excerpt, source reading title, relevance tag (supports / contradicts / extends)
- Can be minimized, repositioned, or closed without affecting the main canvas

### Canvas Conventions

- **Yellow shapes** = AI-generated first pass
- **Colored shapes** = human additions (each student picks a color on first visit)
- Every shape carries `meta: { source: 'ai' | 'human', author: string, timestamp: number }`
- A small legend in the corner shows who's who

### Authentication

Simple and lightweight:

- Shared class password to access the site
- On first visit, students enter their name and pick a color
- Stored in a cookie/local storage — no accounts, no OAuth
- Author identity tracked via shape metadata

---

## The Agents

These are different prompts and context configurations within the same tldraw agent instance, triggered by buttons in the chat panel or nav bar.

### 1. Sketch Agent

**Purpose**: Generate a visual diagram of any single source.

**Input**: One reading (PDF/text) or transcript.
**Output**: Concept nodes and relationship edges on a new canvas tab.

**When used**: Automatically when a new reading is uploaded, or manually via chat.

**Custom components**:
- `ReadingContextPartUtil` — chunks and feeds the reading into the agent's context
- `CreateConceptNodeAction` — places labeled boxes in yellow
- `CreateRelationshipEdgeAction` — draws connecting arrows with relationship labels

### 2. Discussion Preparation Agent ★ Primary

**Purpose**: Identify fault lines and productive tensions across the week's readings to seed the group's async work.

**Input**: All readings assigned for the upcoming week.
**Output**: A pre-populated Weekly Prep canvas showing opposing positions, unresolved tensions, and open questions.

**When used**: Triggered by the instructor (or automatically on a schedule) at the start of each week. Students then spend the week annotating this canvas.

**How it works**:
1. Agent reads all week's materials via `ReadingContextPartUtil`
2. Generates a spatial layout: clusters of related ideas, with tension edges between opposing positions
3. Marks open questions as dedicated question nodes
4. Students add their own colored nodes — positions, counterarguments, connections to other weeks' material

### 3. Matchmaker Agent

**Purpose**: Suggest student pairings or small groups for the next class based on who was most productively in tension during the *previous* discussion.

**Input**: Transcript of the previous class session (via AssemblyAI transcription).
**Output**: A visual grouping overlaid on the current Weekly Prep canvas — student nodes connected to the positions they voiced, with suggested pairings highlighted.

**Custom components**:
- `TranscriptContextPartUtil` — feeds the previous session's transcript into the agent
- The agent infers each student's positions from what they said, then identifies pairings where students would push each other's thinking

**When used**: After a class session transcript is uploaded, before the next session.

### 4. Question Space Agent

**Purpose**: Extract and map the questions raised during a discussion, tracking how they evolve over the semester.

**Input**: Class session transcript.
**Output**: New question and response nodes added to the persistent Question Space canvas.

**When used**: After each class session. The agent adds to the existing canvas rather than creating a new one, so the question space grows over time.

**How it works**:
1. Agent reads the transcript and identifies questions raised
2. Clusters new questions by theme, checking for connections to existing questions on the canvas
3. Maps who responded to each question and what position they took
4. Links back to the relevant Weekly Prep canvas for context

### 5. Adversarial Critic *(deferred — Phase 3+)*

**Purpose**: Periodically review the canvas and challenge weak reasoning.

Uses `agent.schedule()` to scan for claims lacking evidence, logical gaps, or unstated assumptions. Adds challenge nodes that the group must address. Saved for later — the core loop needs to work first.

---

## Data Pipeline

```
Source material
        │
        ├── Readings (PDF/text) ──── upload ────┐
        │                                       │
        └── Class audio ── AssemblyAI ──────────┤
                           (transcription)      │
                                                ▼
                                     PromptPartUtils
                                     (feed context to agent)
                                                │
                                                ▼
                                     tldraw Agent (Claude)
                                                │
                                                ▼
                                     AgentActionUtils
                                     (create/modify shapes)
                                                │
                                                ▼
                                     Yellow shapes on canvas
                                                │
                                                ▼
                                     Human annotation (async)
                                                │
                                                ▼
                                     DB snapshots (versioning)
```

---

## Canvas Structure

| Canvas | Lifecycle | Who populates it |
|---|---|---|
| **Weekly Prep** | New each week, archived after | Discussion Prep Agent → students annotate async |
| **Question Space** | Persistent all semester | Question Space Agent adds after each class → students annotate |
| **Sketch files** | Per-reading, reference only | Sketch Agent auto-generates from each uploaded reading |

Humans decide what gets promoted from sketch files into the Weekly Prep or Question Space. This is manual — drag, copy, rearrange.

---

## Deployment & Infrastructure

### Stack

| Component | Role | Platform |
|---|---|---|
| **tldraw Agent Kit** | Canvas + AI agent (Vite + React + CF Worker) | Cloudflare Pages + Workers |
| **tldraw Sync** | Real-time multiplayer | Cloudflare Durable Objects |
| **Anthropic API** | Powers all agent prompts | — |
| **AssemblyAI** | Audio → transcript | — |
| **Postgres (e.g. Neon, Supabase)** | Canvas snapshots, reading storage, user profiles | Managed service |
| **Vector store** | RAG index for reading recommender | FAISS (local) or Pinecone (managed) |

### Why Cloudflare (not Railway)

The tldraw agent template ships with a `wrangler.toml` already configured for Cloudflare Workers. Going with this means:

- Zero translation from the template — deploy what you build
- Cloudflare Durable Objects handle the multiplayer sync server natively
- Edge deployment = fast for everyone regardless of location
- Free tier is generous for a class-sized project

### Versioning: DB Snapshots, Not Git

~~Git~~ → **Timestamped snapshots in Postgres.**

tldraw's store is a set of JSON records. Git diffs on large JSON blobs are unreadable — you'd never actually look at them. You don't need branching or merging either. What you actually want is:

- A **time slider** in the UI to scrub through how a canvas evolved
- The ability to see **who added what, when** (already tracked via shape `meta`)
- **Weekly archiving** so past canvases are browsable but not cluttering the current view

A simple snapshots table handles all of this:

```sql
CREATE TABLE canvas_snapshots (
  id          SERIAL PRIMARY KEY,
  canvas_id   TEXT NOT NULL,
  snapshot    JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  trigger     TEXT  -- 'auto' | 'manual' | 'agent-action'
);
```

Auto-snapshot every 5 minutes during active editing. Manual snapshot button in the UI. Agent actions trigger a snapshot before and after.

---

## Implementation Phases

### Phase 1: Core Canvas Loop
- [ ] Scaffold tldraw agent template via `npm create tldraw@latest -- --template agent`
- [ ] Create `ReadingContextPartUtil` — upload a reading, feed it to the agent
- [ ] Create `CreateConceptNodeAction` and `CreateRelationshipEdgeAction`
- [ ] Enforce yellow color convention for AI shapes, tag `meta.source`
- [ ] Get one reading → concept map → human annotation working end-to-end
- [ ] Simple auth: password gate + name/color picker
- [ ] Deploy to Cloudflare

### Phase 2: Weekly Workflow
- [ ] Discussion Prep Agent: multi-reading context, fault-line generation
- [ ] Tab navigation between Weekly Prep / Question Space / Sketches
- [ ] Combine with tldraw multiplayer for shared async editing
- [ ] Postgres snapshots with auto-save
- [ ] AssemblyAI integration: upload class recording → transcript
- [ ] Question Space Agent: add to persistent canvas from transcript

### Phase 3: Intelligence Layer
- [ ] Matchmaker Agent: previous transcript → student pairing suggestions
- [ ] Reading recommender: chunk + embed readings, build vector index
- [ ] Popout window UI with live transcription connection
- [ ] Adversarial Critic via `agent.schedule()`
- [ ] Time slider UI for canvas history

---

## Open Questions

- **tldraw licensing**: v4.0 requires a license key for production. Non-commercial academic use likely qualifies for a hobby license — need to apply and confirm before deploying.
- **Canvas scale**: How large can a single tldraw canvas get before performance degrades? The Question Space will grow all semester. May need a "zoom to cluster" UX or periodic archiving of older regions.
- **Reading format**: What formats do readings come in? If mostly PDFs, need a PDF-to-text extraction step before feeding to the agent. If scanned PDFs, need OCR.
- **Live transcription latency**: For the in-class reading recommender, how fast does AssemblyAI's streaming transcription return results? The RAG lookup adds more latency on top. Need to test whether the recommendations feel timely or lagged.
- **Instructor controls**: Should the instructor have special privileges (e.g., triggering the Discussion Prep Agent, uploading readings, archiving weeks)? Or is everyone equal on the canvas?
