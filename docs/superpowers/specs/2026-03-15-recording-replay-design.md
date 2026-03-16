# Recording/Replay Design Spec

## Goal

Cache successful DOM action sequences and replay them on subsequent identical operations, eliminating AI token costs for previously-validated browser automation steps.

## Background

VibPage's hybrid browser automation mode executes tasks step-by-step:
1. DOM mode (gpt-4o-mini) — low cost
2. Vision mode (gpt-5.4 Computer Use) — high cost

Recording adds a zero-cost layer that sits in front of both:
1. **Recording cache** — zero AI cost
2. DOM mode — low cost
3. Vision mode — high cost

## Architecture

### Three-Layer Execution Fallback

```
Task on URL:
  ├─ Cache hit (url + task match)? → Replay entire recorded sequence
  │    ├─ All steps succeed → done (zero AI cost)
  │    └─ Any step fails → discard cache → fall through ↓
  ├─ DOM mode → gpt-4o-mini plans actions → Playwright executes
  │    ├─ Succeeds → record sequence (tentative) → done
  │    └─ Any step fails → vision fallback for that step
  └─ Vision mode → Computer Use executes failed step → continue
```

### Cache Key

Each recording is keyed by **URL pattern + task description** (exact string match):

- **URL pattern**: `hostname + pathname` (query params excluded)
- **Task description**: the exact task string passed to `browser_task`

This means:
- Same page + same task description = cache hit → zero AI cost
- Different phrasing = cache miss → normal AI flow → new recording
- Recordings from Actions (which use fixed step descriptions) hit cache consistently

### Recording Data Structure

```typescript
interface ResolvedAction {
  action: "click" | "fill" | "select" | "keypress" | "scroll" | "goto" | "wait";
  selector?: string;        // Resolved CSS selector (not element index)
  value?: string;           // For fill/select
  keys?: string[];          // For keypress
  direction?: string;       // For scroll
  url?: string;             // For goto
}

interface RecordingEntry {
  id: string;                    // UUID
  urlPattern: string;            // hostname + pathname
  taskDescription: string;       // Exact task string
  actions: ResolvedAction[];     // Ordered action sequence with resolved selectors
  createdAt: string;             // ISO timestamp
  lastUsedAt: string;            // ISO timestamp, updated on replay
  hitCount: number;              // Times successfully replayed
}

interface RecordingStore {
  version: 1;
  entries: RecordingEntry[];
}
```

Key design decision: **`ResolvedAction` uses CSS selectors, not element indices.** The `DomAction.element` field is a numeric index into the current `DomSnapshot.elements[]` array, which changes between page loads. At recording time, we resolve the index to the actual CSS selector string for stable replay.

### Storage

- **File**: `~/.vibpage/recordings.json`
- **Format**: JSON, consistent with existing `config.json` pattern
- **Scope**: User-level (not project-level) — same website operations apply across all projects
- **Write safety**: Atomic writes (write to temp file, then rename) to prevent corruption from concurrent VibPage instances

## Lifecycle

### 1. Cache Lookup (Before Planning)

At the start of each hybrid mode turn:
- Compute `urlPattern` from current page URL
- Look up entries matching `urlPattern + taskDescription` (exact match)
- If found: attempt to replay the full `ResolvedAction[]` sequence
- If all steps succeed: task complete, zero AI cost
- If any step fails: discard the cache entry, fall through to normal planning

### 2. Recording (Automatic)

During normal (non-cached) hybrid mode execution, after each successful DOM action (excluding `done` and `use_vision` meta-actions, which are not recordable):
- Resolve the `DomAction.element` index to CSS selector via `elements[index].selector`
- Create a **tentative** `ResolvedAction` (held in memory, not yet persisted)
- Track all tentative actions for the current task

### 3. Confirmation (End of Task)

When a browser task completes successfully:
- Prompt user: "Task completed. Results correct? (Y/n)"
- **Y (or Enter)**: Persist tentative recordings as a new `RecordingEntry` to `recordings.json`
- **n**: Discard all tentative recordings for this task

### 4. Re-recording (Automatic)

When a cached entry fails and AI mode takes over:
- The failed cache entry is deleted
- Normal AI execution proceeds (DOM → vision fallback)
- New successful actions are recorded as tentative entries
- Same confirmation flow at end of task
- Effectively "updates" the recording for changed pages

### 5. Cache Invalidation

- **Only trigger**: Replay execution failure (selector not found, timeout, etc.)
- **No TTL**: Valid recordings never expire
- **No manual management**: Fully automatic

## Integration Points

### `src/tools/browser-task.ts` — `runHybridMode()`

The main integration point. Modified execution flow:

```
Before:
  loop:
    extract DOM → plan actions → execute one-by-one → vision fallback

After:
  1. Check cache (url + task) → if hit, replay sequence → if all succeed, done
  2. If cache miss or replay fails:
     loop:
       extract DOM → plan actions → execute one-by-one → vision fallback
     Record successful actions as tentative
  3. On task complete: ask user Y/n → commit or discard recordings
```

### `src/tools/recording.ts` — New Module

```typescript
// Storage
loadRecordings(): RecordingStore
saveRecordings(store: RecordingStore): void  // Atomic write

// Cache lookup
findRecording(urlPattern: string, taskDescription: string): RecordingEntry | null

// Tentative recording (in-memory)
startRecordingSession(): void
addTentativeAction(url: string, task: string, action: DomAction, elements: DomElement[]): void
commitRecordings(): void      // Persist tentative → permanent
discardRecordings(): void     // Clear tentative

// Cache management
deleteRecording(id: string): void

// Helpers
getUrlPattern(url: string): string           // hostname + pathname
resolveAction(action: DomAction, elements: DomElement[]): ResolvedAction
```

### `src/tools/dom-executor.ts` — Minor Addition

Add a new function for replaying resolved actions (selector-based, no element lookup):

```typescript
executeResolvedActions(page: Page, actions: ResolvedAction[]): Promise<ExecutionResult[]>
```

This function executes actions using CSS selectors directly (e.g., `page.click(selector)`) instead of looking up elements by index.

### `src/ui.tsx` — Confirmation Prompt

After browser task completes, show confirmation prompt:
- "Task completed. Results correct? (Y/n)"
- Pass result back to recording module via `commitRecordings()` or `discardRecordings()`

## URL Pattern Design

```typescript
function getUrlPattern(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname + parsed.pathname;
}
// "https://www.youtube.com/results?search_query=test" → "www.youtube.com/results"
```

## Replay Execution

```typescript
async function replayRecording(page: Page, entry: RecordingEntry): Promise<boolean> {
  for (const action of entry.actions) {
    const results = await executeResolvedActions(page, [action]);
    if (!results[0].success) {
      return false;  // Any failure = discard entire recording
    }
    await page.waitForTimeout(500);  // Allow page to settle between actions
  }
  return true;
}
```

## User Experience

### Transparent Operation
- User does not need to know recordings exist
- No commands to manage recordings (no `/record`, no `/replay`)
- Works like a browser cache — invisible speedup

### Visible Feedback
- When replaying cached steps, show in logs: `[cached] replaying 3 recorded steps`
- When recording new steps (after confirmation): `[recorded] 3 steps cached for this task`
- Token savings visible in usage summary

### Edge Cases
- **Website redesign**: Cached selectors break → auto-discard → re-learn on next run
- **Same URL, different task**: Different task descriptions → different cache keys → no conflict
- **Actions integration**: Actions use fixed step descriptions → consistent cache hits

## Relationship to Actions

| | Actions | Recordings |
|---|---|---|
| **Purpose** | Reusable workflows with parameters | Cache exact DOM operation sequences |
| **Granularity** | Whole workflow (multi-step, parameterized) | Single task's action sequence |
| **Created by** | User explicitly (`/action save`) | Automatically on success |
| **AI cost** | Full AI interpretation each run | Zero for cached tasks |
| **Flexibility** | High (AI adapts to changes) | None (exact replay) |
| **Complementary** | Yes — recordings speed up action step execution |

## Non-Goals

- No recording of vision mode actions (Computer Use steps are coordinate-based, not DOM-based)
- No cross-device sync (local cache only)
- No recording editing UI
- No semantic/fuzzy matching (exact task string match only)
- No LRU eviction (can be added later if storage grows too large)
