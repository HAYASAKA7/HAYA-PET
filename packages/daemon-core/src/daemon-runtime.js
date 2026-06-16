import { assertProtocolMessage } from "../../protocol/src/messages.js";
import { createSessionRegistry } from "../../session-core/src/registry.js";
import { attachProtocolStream } from "./ipc-transport.js";

export function createDaemonRuntime(options = {}) {
  const registry = options.registry ?? createSessionRegistry(options.registryOptions);
  const onSessionChanged = options.onSessionChanged ?? noop;
  const onProtocolError = options.onProtocolError ?? noop;

  return {
    registry,

    handleMessage(message) {
      const checked = assertProtocolMessage(message);
      const session = registry.applyMessage(checked);
      onSessionChanged(session);
      return session;
    },

    attachStream(stream) {
      return attachProtocolStream(stream, {
        onMessage: (message) => {
          this.handleMessage(message);
        },
        onError: onProtocolError
      });
    },

    getSession(sessionId) {
      return registry.getSession(sessionId);
    },

    listSessions() {
      return registry.listSessions();
    },

    getPrioritySession(priorityOptions = {}) {
      return registry.getPrioritySession(priorityOptions);
    },

    markStaleSessions(now) {
      const staleSessions = registry.markStaleSessions(now);
      for (const session of staleSessions) {
        onSessionChanged(session);
      }
      return staleSessions;
    }
  };
}

function noop() {}
