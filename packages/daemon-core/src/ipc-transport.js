import { assertProtocolMessage } from "../../protocol/src/messages.js";

export function encodeProtocolMessage(message) {
  assertProtocolMessage(message);
  return `${JSON.stringify(message)}\n`;
}

export function writeProtocolMessage(writable, message) {
  return writable.write(encodeProtocolMessage(message));
}

export function createProtocolMessageReader({ onMessage, onError = defaultErrorHandler } = {}) {
  if (typeof onMessage !== "function") {
    throw new TypeError("onMessage must be a function");
  }

  let buffer = "";

  return {
    push(chunk) {
      buffer += chunk.toString("utf8");

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        readFrame(line, onMessage, onError);
        newlineIndex = buffer.indexOf("\n");
      }
    },

    flush() {
      if (buffer.trim() !== "") {
        readFrame(buffer, onMessage, onError);
      }
      buffer = "";
    }
  };
}

export function attachProtocolStream(readable, options) {
  const reader = createProtocolMessageReader(options);
  readable.on("data", (chunk) => reader.push(chunk));
  readable.on("end", () => reader.flush());
  return reader;
}

function readFrame(line, onMessage, onError) {
  if (line.trim() === "") {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    onError(new Error(`Invalid protocol JSON frame: ${error.message}`));
    return;
  }

  try {
    onMessage(assertProtocolMessage(message));
  } catch (error) {
    onError(error);
  }
}

function defaultErrorHandler(error) {
  throw error;
}
