# Recording/Replay Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache successful DOM action sequences and replay them to eliminate AI token costs for previously-validated browser tasks.

**Architecture:** New `recording.ts` module handles storage/lookup/lifecycle. `browser-task.ts` checks cache before planning, records successful actions, and prompts for confirmation. `dom-executor.ts` gets a new `executeResolvedActions()` function for selector-based replay. UI gets a Y/n confirmation prompt after browser tasks complete.

**Tech Stack:** Node.js, TypeScript, Playwright, JSON file storage (`~/.vibpage/recordings.json`)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/tools/recording.ts` | Create | Recording storage, lookup, tentative session management |
| `src/tools/dom-executor.ts` | Modify | Add `executeResolvedActions()` for selector-based replay |
| `src/tools/browser-task.ts` | Modify | Integrate cache lookup, recording, and confirmation flow |

---

## Chunk 1: Recording Module + Executor Extension

### Task 1: Create `src/tools/recording.ts`

**Files:**
- Create: `src/tools/recording.ts`

- [ ] **Step 1: Create the recording module with types and storage functions**

```typescript
// src/tools/recording.ts
// Recording/replay cache for DOM action sequences

import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { tmpdir } from "os";
import type { DomAction } from "./dom-planner.js";
import type { DomElement } from "./dom-extractor.js";

export interface ResolvedAction {
  action: "click" | "fill" | "select" | "keypress" | "scroll" | "goto" | "wait";
  selector?: string;
  value?: string;
  keys?: string[];
  direction?: string;
  url?: string;
}

export interface RecordingEntry {
  id: string;
  urlPattern: string;
  taskDescription: string;
  actions: ResolvedAction[];
  createdAt: string;
  lastUsedAt: string;
  hitCount: number;
}

interface RecordingStore {
  version: 1;
  entries: RecordingEntry[];
}

const RECORDINGS_PATH = join(homedir(), ".vibpage", "recordings.json");

// --- Storage ---

export function loadRecordings(): RecordingStore {
  if (!existsSync(RECORDINGS_PATH)) {
    return { version: 1, entries: [] };
  }
  try {
    const data = JSON.parse(readFileSync(RECORDINGS_PATH, "utf-8"));
    return data as RecordingStore;
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveRecordings(store: RecordingStore): void {
  const tempPath = join(tmpdir(), `vibpage-recordings-${Date.now()}.json`);
  writeFileSync(tempPath, JSON.stringify(store, null, 2));
  renameSync(tempPath, RECORDINGS_PATH);
}

// --- Helpers ---

export function getUrlPattern(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch {
    return url;
  }
}

export function resolveAction(action: DomAction, elements: DomElement[]): ResolvedAction | null {
  if (action.action === "done" || action.action === "use_vision") {
    return null;
  }

  const el = action.element !== undefined
    ? elements.find(e => e.index === action.element)
    : null;

  const resolved: ResolvedAction = { action: action.action as ResolvedAction["action"] };

  if (el) resolved.selector = el.selector;
  if (action.value !== undefined) resolved.value = action.value;
  if (action.keys) resolved.keys = action.keys;
  if (action.direction) resolved.direction = action.direction;
  if (action.url) resolved.url = action.url;

  return resolved;
}

// --- Cache Lookup ---

export function findRecording(urlPattern: string, taskDescription: string): RecordingEntry | null {
  const store = loadRecordings();
  return store.entries.find(
    e => e.urlPattern === urlPattern && e.taskDescription === taskDescription
  ) || null;
}

// --- Tentative Recording Session ---

let tentativeActions: ResolvedAction[] = [];
let tentativeUrl: string = "";
let tentativeTask: string = "";

export function startRecordingSession(url: string, task: string): void {
  tentativeActions = [];
  tentativeUrl = getUrlPattern(url);
  tentativeTask = task;
}

export function addTentativeAction(action: DomAction, elements: DomElement[]): void {
  const resolved = resolveAction(action, elements);
  if (resolved) {
    tentativeActions.push(resolved);
  }
}

export function hasTentativeActions(): boolean {
  return tentativeActions.length > 0;
}

export function commitRecordings(): number {
  if (tentativeActions.length === 0) return 0;

  const store = loadRecordings();

  // Remove existing entry for same url+task if any
  store.entries = store.entries.filter(
    e => !(e.urlPattern === tentativeUrl && e.taskDescription === tentativeTask)
  );

  store.entries.push({
    id: randomUUID(),
    urlPattern: tentativeUrl,
    taskDescription: tentativeTask,
    actions: [...tentativeActions],
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    hitCount: 0,
  });

  saveRecordings(store);
  const count = tentativeActions.length;
  tentativeActions = [];
  tentativeUrl = "";
  tentativeTask = "";
  return count;
}

export function discardRecordings(): void {
  tentativeActions = [];
  tentativeUrl = "";
  tentativeTask = "";
}

// --- Cache Management ---

export function deleteRecording(id: string): void {
  const store = loadRecordings();
  store.entries = store.entries.filter(e => e.id !== id);
  saveRecordings(store);
}

export function updateRecordingUsage(id: string): void {
  const store = loadRecordings();
  const entry = store.entries.find(e => e.id === id);
  if (entry) {
    entry.lastUsedAt = new Date().toISOString();
    entry.hitCount++;
    saveRecordings(store);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to recording.ts

- [ ] **Step 3: Commit**

```bash
git add src/tools/recording.ts
git commit -m "feat: add recording module for DOM action caching"
```

---

### Task 2: Add `executeResolvedActions()` to `dom-executor.ts`

**Files:**
- Modify: `src/tools/dom-executor.ts`

- [ ] **Step 1: Add the ResolvedAction import and executeResolvedActions function**

At the top of `dom-executor.ts`, add the import:
```typescript
import type { ResolvedAction } from "./recording.js";
```

After the existing `executeDomActions` function (after line 90), add:

```typescript
export async function executeResolvedActions(
  page: any,
  actions: ResolvedAction[]
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  for (const action of actions) {
    try {
      switch (action.action) {
        case "click": {
          if (!action.selector) throw new Error("No selector for click");
          await page.click(action.selector, { timeout: 5000 });
          await page.waitForTimeout(500);
          break;
        }
        case "fill": {
          if (!action.selector) throw new Error("No selector for fill");
          await page.fill(action.selector, action.value || "", { timeout: 5000 });
          break;
        }
        case "select": {
          if (!action.selector) throw new Error("No selector for select");
          await page.selectOption(action.selector, action.value || "", { timeout: 5000 });
          break;
        }
        case "keypress": {
          for (const key of action.keys || []) {
            await page.keyboard.press(key);
          }
          await page.waitForTimeout(300);
          break;
        }
        case "scroll": {
          const delta = action.direction === "up" ? -500 : 500;
          await page.mouse.wheel(0, delta);
          await page.waitForTimeout(500);
          break;
        }
        case "wait": {
          await page.waitForTimeout(2000);
          break;
        }
        case "goto": {
          if (action.url) {
            await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(1000);
          }
          break;
        }
      }

      // Convert ResolvedAction to DomAction shape for ExecutionResult
      results.push({
        success: true,
        action: {
          action: action.action,
          value: action.value,
          keys: action.keys,
          direction: action.direction,
          url: action.url,
        },
      });
    } catch (err) {
      results.push({
        success: false,
        action: {
          action: action.action,
          value: action.value,
          keys: action.keys,
          direction: action.direction,
          url: action.url,
        },
        error: (err as Error).message,
      });
      break;
    }
  }

  return results;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/dom-executor.ts
git commit -m "feat: add executeResolvedActions for cached replay"
```

---

## Chunk 2: Integration into browser-task.ts and UI

### Task 3: Integrate recording into `runHybridMode()`

**Files:**
- Modify: `src/tools/browser-task.ts`

- [ ] **Step 1: Add recording imports**

At the top of `browser-task.ts`, after existing imports (line 8), add:

```typescript
import {
  findRecording,
  startRecordingSession,
  addTentativeAction,
  deleteRecording,
  updateRecordingUsage,
  getUrlPattern,
} from "./recording.js";
import { executeResolvedActions } from "./dom-executor.js";
```

Note: `executeResolvedActions` is a new named import from `dom-executor.js`. The existing import `{ executeDomActions, formatResults }` stays unchanged.

- [ ] **Step 2: Add cache lookup at the start of `runHybridMode()`**

Replace the beginning of `runHybridMode()` (lines 397-406) — specifically after the function signature and before the while loop — with:

```typescript
async function runHybridMode(
  page: any,
  apiConfig: BrowserApiConfig,
  task: string,
  url: string,
  precision: Precision,
  logs: string[]
): Promise<void> {
  // Check recording cache before starting AI planning
  const urlPattern = getUrlPattern(url);
  const cached = findRecording(urlPattern, task);
  if (cached) {
    logs.push(`[cached] Replaying ${cached.actions.length} recorded steps...`);
    const results = await executeResolvedActions(page, cached.actions);
    const allSuccess = results.every(r => r.success);
    if (allSuccess) {
      updateRecordingUsage(cached.id);
      logs.push(`[cached] All ${cached.actions.length} steps replayed successfully`);
      return;
    }
    // Cache failed — delete and fall through to normal mode
    logs.push(`[cached] Replay failed, falling back to AI mode`);
    deleteRecording(cached.id);
  }

  // Start tentative recording session for this task
  startRecordingSession(url, task);

  let turns = 0;
  let previousActionLog: string[] = [];
```

- [ ] **Step 3: Add recording of successful DOM actions in the execution loop**

Inside the for loop over `executableActions` (around line 464), after the DOM action succeeds, add a call to `addTentativeAction`. Find this block:

```typescript
      if (r.success) {
        const desc = `${r.action.action}${r.action.element ? ` [${r.action.element}]` : ""}${r.action.value ? ` "${r.action.value}"` : ""}`;
        turnLog.push(`✓ DOM: ${desc}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
```

Replace with:

```typescript
      if (r.success) {
        const desc = `${r.action.action}${r.action.element ? ` [${r.action.element}]` : ""}${r.action.value ? ` "${r.action.value}"` : ""}`;
        turnLog.push(`✓ DOM: ${desc}`);
        addTentativeAction(action, snapshot.elements);
        await new Promise((resolve) => setTimeout(resolve, 500));
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/tools/browser-task.ts
git commit -m "feat: integrate recording cache into hybrid mode"
```

---

### Task 4: Add confirmation flow to `browser-task.ts` execute function and export state

**Files:**
- Modify: `src/tools/browser-task.ts`

- [ ] **Step 1: Add pending confirmation exports**

Add these imports to the recording import block at the top:

```typescript
import {
  findRecording,
  startRecordingSession,
  addTentativeAction,
  hasTentativeActions,
  commitRecordings,
  discardRecordings,
  deleteRecording,
  updateRecordingUsage,
  getUrlPattern,
} from "./recording.js";
```

After the `isBrowserOpen()` function (around line 22), add:

```typescript
import { hasTentativeActions, commitRecordings, discardRecordings } from "./recording.js";

export function hasPendingRecording(): boolean {
  return hasTentativeActions();
}

export function confirmRecording(): number {
  return commitRecordings();
}

export function rejectRecording(): void {
  discardRecordings();
}
```

Wait — this would duplicate the import. Instead, consolidate all recording imports into one statement and add the exports after existing browser state functions.

The consolidated import (replacing the one from Step 1 of Task 3):

```typescript
import {
  findRecording,
  startRecordingSession,
  addTentativeAction,
  hasTentativeActions,
  commitRecordings,
  discardRecordings,
  deleteRecording,
  updateRecordingUsage,
  getUrlPattern,
} from "./recording.js";
```

Then after `isBrowserOpen()` and `closeBrowser()` (after line 31), add:

```typescript
export function hasPendingRecording(): boolean {
  return hasTentativeActions();
}

export function confirmRecording(): number {
  return commitRecordings();
}

export function rejectRecording(): void {
  discardRecordings();
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/browser-task.ts
git commit -m "feat: export recording confirmation functions"
```

---

### Task 5: Add recording confirmation to UI

**Files:**
- Modify: `src/ui.tsx`

- [ ] **Step 1: Add imports**

Add to the import from `browser-task.js` (line 13):

```typescript
import { closeBrowser, openBrowser, isBrowserOpen, hasPendingRecording, confirmRecording, rejectRecording } from "./tools/browser-task.js";
```

- [ ] **Step 2: Add pending recording confirmation state**

After the `pendingExitRef` declaration (line 429), add:

```typescript
  const [pendingRecording, setPendingRecording] = useState(false);
  const pendingRecordingRef = useRef(false);
```

- [ ] **Step 3: Add recording confirmation handler in handleSubmit**

In `handleSubmit`, after the `pendingExitRef` handling block (after line 1019, the `return` statement), add:

```typescript
      // Handle pending recording confirmation
      if (pendingRecordingRef.current) {
        setInput("");
        setPendingRecording(false);
        pendingRecordingRef.current = false;
        const lower = trimmed.toLowerCase();
        if (lower === "" || lower === "y" || lower === "yes") {
          const count = confirmRecording();
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "info", text: `[recorded] ${count} steps cached` },
          ]);
        } else {
          rejectRecording();
        }
        return;
      }
```

- [ ] **Step 4: Show confirmation prompt after agent finishes browser tasks**

In the `sendPrompt` function, after `await agent.waitForIdle();` (line 797), add the recording confirmation check:

```typescript
        await agent.waitForIdle();

        // Check if there are tentative recordings to confirm
        if (hasPendingRecording()) {
          const confirmTexts: Record<string, string> = {
            "zh-CN": "任务完成。结果正确吗？(Y/n)",
            "zh-TW": "任務完成。結果正確嗎？(Y/n)",
            en: "Task completed. Results correct? (Y/n)",
            fr: "Tâche terminée. Résultats corrects ? (Y/n)",
            de: "Aufgabe erledigt. Ergebnisse korrekt? (Y/n)",
            es: "Tarea completada. ¿Resultados correctos? (Y/n)",
            pt: "Tarefa concluída. Resultados corretos? (Y/n)",
            ko: "작업 완료. 결과가 맞나요? (Y/n)",
            ja: "タスク完了。結果は正しいですか？(Y/n)",
          };
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "info", text: confirmTexts[currentLang] || confirmTexts.en },
          ]);
          setPendingRecording(true);
          pendingRecordingRef.current = true;
        }
```

- [ ] **Step 5: Update TextInput focus to respect pendingRecording**

Change the TextInput focus prop (line 1183):

```typescript
focus={!isLoading && !isRemoteLocked && !pendingRecording && (!isMenuMode || mode === "command-select")}
```

Wait — actually the user needs to be able to type Y/n, so focus should remain enabled during pendingRecording. The current focus logic already allows it since pendingRecording doesn't block focus. The `handleSubmit` intercept handles the Y/n response. No change needed here.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/ui.tsx
git commit -m "feat: add recording confirmation prompt in UI"
```

---

### Task 6: Build, manual test, and version bump

**Files:**
- Modify: `package.json` (version bump)

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Compiles without errors

- [ ] **Step 2: Manual test checklist**

Test the following scenarios:

1. **Normal task (no cache)**: Run a browser task → should see normal execution → after completion, see "Results correct? (Y/n)" → type Y → see "[recorded] N steps cached"
2. **Cached replay**: Run the exact same task again → should see "[cached] Replaying N recorded steps..." → completes without AI calls
3. **Cache rejection**: Run a new task → when prompted, type N → verify no recording saved (check `~/.vibpage/recordings.json`)
4. **Cache invalidation**: Manually edit `~/.vibpage/recordings.json` to break a selector → run the cached task → should see "[cached] Replay failed, falling back to AI mode" → normal AI execution

- [ ] **Step 3: Version bump and commit**

In `package.json`, bump version from current to next patch.

```bash
git add package.json src/
git commit -m "feat: recording/replay for DOM action caching"
```
