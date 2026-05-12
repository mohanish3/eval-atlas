# UI-Based Evals Feature Spec

This document defines the feature for creating eval sets directly in the Eval Atlas UI instead of requiring an uploaded JSON/JSONL file.

## Summary

Today, Eval Atlas creates runs from an uploaded eval file. This feature adds a first-class eval authoring workflow in the dashboard:

- Users can create and edit eval sets in an Excel-like table in the browser
- Users can add, update, and remove rows without leaving the app
- Eval sets are saved to Postgres so they can be reused across runs
- Users can generate synthetic rows with AI based on a few existing rows
- AI-generated rows are clearly labeled in the UI and persisted with provenance metadata

The goal is to make eval creation part of the product, not a preprocessing step outside the product.

---

## Problem

The current flow in [frontend/src/pages/EvalsDashboard.tsx](../frontend/src/pages/EvalsDashboard.tsx) and [backend/src/routes/evals.ts](../backend/src/routes/evals.ts) assumes eval data enters the system through `evalFile` upload only. That creates several problems:

- Users must prepare eval data outside the app
- Small edits require regenerating and re-uploading files
- There is no reusable library of eval sets in the database
- Synthetic data generation is disconnected from the place where evals are reviewed and run

---

## Goals

- Create eval sets directly in the UI
- Support spreadsheet-style row editing for fast authoring
- Persist authored eval sets and rows in Postgres
- Reuse a saved eval set when launching a run
- Generate new rows with AI from a small seed set
- Mark AI-generated rows so they remain distinguishable from human-authored rows

## Non-Goals

- Replacing the existing JSON/JSONL upload flow in this phase
- Supporting collaborative multi-user editing or real-time presence
- Supporting formulas, merged cells, or full spreadsheet parity
- Auto-running evals immediately after generation without user review

---

## User Stories

1. As a user, I can create a new eval set from the dashboard without preparing a file.
2. As a user, I can add rows in a grid quickly, similar to a spreadsheet.
3. As a user, I can save the eval set and come back later to keep editing it.
4. As a user, I can launch a run from a saved eval set instead of uploading a file.
5. As a user, I can select a few strong examples and ask AI to generate similar eval rows.
6. As a user, I can see which rows were AI-generated before deciding whether to keep them.

---

## Proposed UX

### Entry Points

Add a second path alongside the current file upload flow in the Eval Dashboard:

- `Upload eval file`
- `Create`

Selecting `Create in UI` opens an eval builder experience instead of the current file picker.

### Eval Builder Layout

The builder should be a dedicated panel or route, for example:

- `/evals/builder/new`
- `/evals/builder/:evalSetId`

The screen should contain:

- Eval set metadata section
- Spreadsheet-style row editor
- Save controls
- `Generate with AI` action
- Preview of validation errors
- `Use for run` or `Start run with this eval` CTA

### Eval Set Metadata

Required metadata:

- `name`

Optional metadata:

- `description`
- `default system prompt`
- `tags`

### Spreadsheet-Style Editor

The row editor should feel closer to Airtable/Sheets than a long form. It does not need full spreadsheet behavior, but it must support fast keyboard-first editing.

Columns:

- `id`
- `question`
- `type`
- `choices`
- `correct_answer`
- `match_type`
- `category`
- `origin`

Behavior:

- Users can add a blank row with `+ Add row`
- Users can delete a row
- Users can duplicate a row
- Users can tab between cells
- Pressing Enter on the last row creates a new row
- Invalid cells show inline validation
- `type` changes row behavior:
  - `multiple_choice`: enable structured choices editing and require A-D choices
  - `open_ended`: hide or disable choices input and allow `match_type`

### Choices Editing

For `multiple_choice`, the `choices` cell should open a structured editor rather than forcing raw JSON entry.

Minimum supported structure:

- Choice A
- Choice B
- Choice C
- Choice D

The saved row should still map to the current backend `choices: Record<string, string>` shape.

### AI Generation UX

Add a `Generate with AI` button above the grid.

Expected flow:

1. User selects one or more seed rows, or if none are selected the system uses the first few valid rows.
2. User opens a lightweight generation modal.
3. User sets:
   - number of rows to generate
   - optional category focus
   - optional difficulty/style guidance
4. System generates candidate rows.
5. Generated rows are appended to the grid in draft state.
6. Each generated row displays an `AI generated` label.

The generated rows must remain editable before save and before run launch.

### AI Generated Label

Each AI-created row must show a visible label, badge, or pill with text:

- `AI generated`

This label should appear:

- in the builder grid
- in any eval set preview screen
- in row detail or inspection UI, if added later

The label does not need to appear in run results unless row provenance is explicitly surfaced there.

---

## Data Model

The current `eval_runs` table stores `eval_set_data` directly on a run. This feature needs durable eval-set entities separate from runs so authored sets can be reused.

### New Tables

#### `eval_sets`

Stores eval set metadata.

Suggested fields:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | generated server-side |
| `name` | TEXT NOT NULL | display name |
| `description` | TEXT NULL | optional |
| `default_system_prompt` | TEXT NULL | optional |
| `tags` | JSONB NOT NULL DEFAULT `[]` | string array |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `eval_set_items`

Stores individual eval rows.

Suggested fields:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | row identity |
| `eval_set_id` | UUID FK | references `eval_sets(id)` |
| `item_key` | TEXT NOT NULL | stable logical row id exposed as current `EvalItem.id` |
| `question` | TEXT NOT NULL | |
| `type` | TEXT NOT NULL | `multiple_choice` or `open_ended` |
| `choices` | JSONB NULL | A-D map for MC |
| `correct_answer` | TEXT NOT NULL | |
| `match_type` | TEXT NULL | `exact`, `contains`, `regex` |
| `category` | TEXT NULL | |
| `origin` | TEXT NOT NULL DEFAULT `'human'` | `human` or `ai_generated` |
| `generation_context` | JSONB NULL | metadata about AI generation |
| `sort_order` | INTEGER NOT NULL | preserve UI row order |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### Run Storage Impact

`eval_runs` should continue storing a snapshot of the eval items used at run time. That preserves historical accuracy even if the source eval set changes later.

Suggested additions to `eval_runs`:

| Field | Type | Notes |
|---|---|---|
| `eval_set_id` | UUID NULL | source saved eval set |
| `eval_set_version` | INTEGER NULL | optional future-proofing if versioning is added |

For phase 1, versioning can be omitted if run creation always snapshots the current set into `eval_set_data`.

---

## API Changes

### New Eval Set APIs

Add CRUD endpoints for saved eval sets.

Suggested endpoints:

- `GET /api/evals/sets`
- `POST /api/evals/sets`
- `GET /api/evals/sets/:id`
- `PUT /api/evals/sets/:id`
- `DELETE /api/evals/sets/:id`

`POST` and `PUT` should accept:

- set metadata
- ordered list of items

The payload item shape should remain aligned with [backend/src/shared/evalTypes.ts](../backend/src/shared/evalTypes.ts), with added provenance metadata:

```ts
type EvalItemOrigin = 'human' | 'ai_generated';

interface AuthoredEvalItem extends EvalItem {
  origin?: EvalItemOrigin;
  generation_context?: {
    sourceItemKeys?: string[];
    promptVersion?: string;
    model?: string;
    generatedAt?: string;
  };
}
```

### New AI Generation API

Suggested endpoint:

- `POST /api/evals/sets/:id/generate`

Request body:

- `seedItemKeys: string[]`
- `count: number`
- `category?: string`
- `instructions?: string`

Response:

- generated rows only, not auto-saved unless the user saves the full eval set

This keeps generation reviewable and avoids silent writes.

### Run Creation API

Extend the current `POST /api/evals/runs` behavior to support one of:

- existing `evalFile`
- `evalSetId`
- inline `evalItems`

Preferred phase-1 run creation from authored sets:

- frontend sends `evalSetId`
- backend loads items from DB
- backend snapshots items into `eval_runs.eval_set_data`

This preserves compatibility with the existing runner, scorer, and results pipeline.

---

## Validation Rules

UI and backend should both enforce:

- eval set must contain at least 1 row
- `id` / `item_key` must be non-empty and unique within an eval set
- `question` must be non-empty
- `type` must be `multiple_choice` or `open_ended`
- `correct_answer` must be non-empty
- `multiple_choice` rows must have choices A-D
- `multiple_choice.correct_answer` must match one of the available choice keys
- `open_ended` rows must not require choices
- `match_type` allowed values remain `exact`, `contains`, `regex`

Validation should be optimistic in the grid and authoritative in the API.

---

## AI Generation Requirements

### Functional Requirements

- Generation uses a small set of user-approved seed rows
- Generated rows must conform to the same eval schema as hand-authored rows
- Generated rows are inserted as editable draft rows
- Generated rows default `origin = 'ai_generated'`
- Generation metadata is stored in `generation_context`

### Quality Guardrails

- Do not auto-save generated rows before the user reviews them
- Do not auto-run generated rows before the user saves or confirms the eval set
- Reject malformed AI output server-side
- Prefer structured JSON generation and validate with Zod before returning rows

### Prompting Direction

The generation prompt should instruct the model to preserve:

- task format
- expected answer style
- difficulty level
- category intent

It should avoid:

- near-duplicate questions
- leaking exact seed wording repeatedly
- changing row type unless explicitly requested

---

## Frontend Changes

Areas likely affected:

- [frontend/src/pages/EvalsDashboard.tsx](../frontend/src/pages/EvalsDashboard.tsx)
- `frontend/src/services/api.ts`
- new builder page/components under `frontend/src/components/evals/` or `frontend/src/pages/`

Expected additions:

- saved eval set list or picker
- builder route and state management
- spreadsheet/grid component
- row validation UI
- AI generation modal
- AI-generated badge rendering

The existing upload flow should remain available. This feature adds an authored path; it should not block existing file-based runs.

---

## Backend Changes

Areas likely affected:

- [backend/src/routes/evals.ts](../backend/src/routes/evals.ts)
- [backend/src/evals/evalSchema.ts](../backend/src/evals/evalSchema.ts)
- [backend/src/shared/evalTypes.ts](../backend/src/shared/evalTypes.ts)
- new migration after [backend/src/db/migrations/009_create_eval_tables.ts](../backend/src/db/migrations/009_create_eval_tables.ts)

Expected additions:

- eval set CRUD routes
- eval set item persistence queries
- generation route
- extended shared types for authored rows
- migrations for `eval_sets` and `eval_set_items`
- optional `eval_runs.eval_set_id`

The existing runner should need minimal change if it still receives `EvalItem[]` at execution time.

---

## Acceptance Criteria

1. User can create a new eval set in the UI without uploading a file.
2. User can add, edit, duplicate, and delete rows in an Excel-like grid.
3. User can save the eval set to Postgres and reopen it later with the same rows and ordering.
4. User can launch a run from a saved eval set.
5. User can generate additional rows with AI using a few existing rows as seeds.
6. All generated rows are visibly labeled `AI generated`.
7. Generated rows are editable before save and before run launch.
8. Backend rejects invalid rows even if the UI misses a validation case.
9. Existing file-upload run creation continues to work.

---

## Rollout Notes

Recommended implementation order:

1. Add DB tables and backend CRUD APIs for saved eval sets.
2. Add UI builder with spreadsheet editing and save/load.
3. Add run creation from saved eval sets.
4. Add AI generation and provenance labels.

This order keeps the feature shippable in slices and avoids coupling AI generation to the first persistence milestone.
