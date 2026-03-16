// Recording/replay cache for DOM action sequences
// Caches successful DOM actions and replays them to save AI token costs

import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
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

const CONFIG_DIR = join(homedir(), ".vibpage");
const RECORDINGS_PATH = join(CONFIG_DIR, "recordings.json");

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
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tempPath = join(CONFIG_DIR, `recordings.tmp.${Date.now()}.json`);
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

export function seedTentativeActions(actions: ResolvedAction[]): void {
  tentativeActions.push(...actions);
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
  if (tentativeActions.length === 0) {
    tentativeActions = [];
    tentativeUrl = "";
    tentativeTask = "";
    return 0;
  }

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
