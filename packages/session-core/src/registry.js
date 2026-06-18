import { assertProtocolMessage } from "../../protocol/src/messages.js";
import { selectPrioritySession } from "./priority.js";

const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_DROP_AFTER_MS = 120_000;

export function createSessionRegistry(options = {}) {
  return new SessionRegistry(options);
}

class SessionRegistry {
  constructor(options) {
    this.sessions = new Map();
    this.lastStateUpdatedAt = new Map();
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.dropAfterMs = options.dropAfterMs ?? DEFAULT_DROP_AFTER_MS;
  }

  applyMessage(message) {
    assertProtocolMessage(message);

    switch (message.type) {
      case "register":
        return this.register(message);
      case "heartbeat":
        return this.applyHeartbeat(message);
      case "state":
        return this.applyState(message);
      case "unregister":
        return this.unregister(message);
      default:
        throw new Error(`Unsupported protocol message type: ${message.type}`);
    }
  }

  getSession(sessionId) {
    return snapshotSession(this.sessions.get(sessionId));
  }

  listSessions() {
    return Array.from(this.sessions.values(), snapshotSession);
  }

  getPrioritySession(options = {}) {
    return selectPrioritySession(this.listSessions(), options);
  }

  markStaleSessions(now) {
    if (!Number.isFinite(now)) {
      throw new TypeError("now must be a finite timestamp");
    }

    const staleSessions = [];

    for (const [sessionId, session] of this.sessions) {
      // Drop sessions with no real activity for dropAfterMs (dead wrappers that
      // never sent unregister, or long-finished sessions) so the pet does not
      // sit on a phantom session forever. The drop clock is based on the last
      // real update — marking stale must NOT bump updatedAt, or it never elapses.
      if (now - session.updatedAt > this.dropAfterMs) {
        this.sessions.delete(sessionId);
        this.lastStateUpdatedAt.delete(sessionId);
        continue;
      }

      if (session.state === "exited" || session.state === "stale") {
        continue;
      }

      if (now - session.updatedAt > this.staleAfterMs) {
        session.state = "stale";
        session.source = "wrapper";
        session.confidence = 0.3;
        session.summary = "heartbeat stale";
        this.lastStateUpdatedAt.set(sessionId, now);
        staleSessions.push(snapshotSession(session));
      }
    }

    return staleSessions;
  }

  register(message) {
    const session = {
      sessionId: message.sessionId,
      clientId: message.clientId,
      clientDisplayName: message.clientDisplayName,
      pid: message.pid,
      terminalPid: message.terminalPid,
      cwd: message.cwd,
      projectName: message.projectName,
      state: "idle",
      source: "wrapper",
      startedAt: message.startedAt,
      updatedAt: message.startedAt
    };

    this.sessions.set(message.sessionId, session);
    this.lastStateUpdatedAt.set(message.sessionId, message.startedAt);
    return snapshotSession(session);
  }

  applyHeartbeat(message) {
    const session = this.requireSession(message.sessionId);
    session.updatedAt = message.updatedAt;
    return snapshotSession(session);
  }

  applyState(message) {
    const session = this.requireSession(message.sessionId);
    const lastStateUpdatedAt = this.lastStateUpdatedAt.get(message.sessionId) ?? session.startedAt;

    if (message.updatedAt < lastStateUpdatedAt) {
      return snapshotSession(session);
    }

    this.lastStateUpdatedAt.set(message.sessionId, message.updatedAt);
    session.state = message.state;
    session.confidence = message.confidence;
    session.source = message.source;
    session.updatedAt = Math.max(session.updatedAt, message.updatedAt);

    if (Object.prototype.hasOwnProperty.call(message, "summary")) {
      session.summary = message.summary;
    } else {
      delete session.summary;
    }

    return snapshotSession(session);
  }

  unregister(message) {
    const session = this.requireSession(message.sessionId);
    session.state = "exited";
    session.source = "wrapper";
    session.confidence = 1;
    session.exitCode = message.exitCode;
    session.finishedAt = message.finishedAt;
    session.updatedAt = message.finishedAt;
    this.lastStateUpdatedAt.set(message.sessionId, message.finishedAt);
    return snapshotSession(session);
  }

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return session;
  }
}

function snapshotSession(session) {
  return session ? { ...session } : undefined;
}
