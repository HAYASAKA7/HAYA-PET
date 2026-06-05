import { normalizeTaskEvent } from "./task-events.js";
import { mapTaskStatusToAiState, mapTaskStatusToPetAction } from "./task-status.js";

const DEFAULT_MAX_EVENTS = 200;

export function createTaskStore(options = {}) {
  return new TaskStore(options);
}

class TaskStore {
  constructor(options) {
    this.maxEventsPerSession = options.maxEventsPerSession ?? DEFAULT_MAX_EVENTS;
    this.events = new Map();
    this.snapshots = new Map();
  }

  appendEvent(input) {
    const result = normalizeTaskEvent(input);
    if (!result.ok) {
      throw new Error(result.errors.join("; "));
    }

    const event = result.event;
    const list = this.events.get(event.sessionId) ?? [];
    list.push(event);

    while (list.length > this.maxEventsPerSession) {
      list.shift();
    }

    this.events.set(event.sessionId, list);

    if (event.status !== undefined) {
      this.updateSnapshot(event);
    }

    return { ...event };
  }

  getEvents(sessionId, options = {}) {
    const list = this.events.get(sessionId) ?? [];
    const events = options.limit ? list.slice(-options.limit) : list.slice();
    return events.map((event) => ({ ...event }));
  }

  getLatestEvent(sessionId) {
    const list = this.events.get(sessionId);
    if (!list || list.length === 0) {
      return undefined;
    }

    return { ...list[list.length - 1] };
  }

  getStatusSnapshot(sessionId) {
    const snapshot = this.snapshots.get(sessionId);
    return snapshot ? { ...snapshot } : undefined;
  }

  updateSnapshot(event) {
    const previous = this.snapshots.get(event.sessionId);

    this.snapshots.set(event.sessionId, {
      sessionId: event.sessionId,
      status: event.status,
      aiState: mapTaskStatusToAiState(event.status),
      petAction: mapTaskStatusToPetAction(event.status),
      confidence: Number.isFinite(event.confidence) ? event.confidence : previous?.confidence ?? 1,
      source: event.source ?? previous?.source ?? "manual",
      updatedAt: event.timestamp,
      summary: event.text ?? previous?.summary
    });
  }
}
