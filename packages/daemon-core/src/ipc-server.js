import { mkdir } from "node:fs/promises";
import net from "node:net";
import { dirname } from "node:path";
import { attachProtocolStream, writeProtocolMessage } from "./ipc-transport.js";

export async function createIpcServer(options = {}) {
  const {
    endpoint,
    platform = process.platform,
    onMessage,
    onProtocolError = noop
  } = options;

  if (typeof onMessage !== "function") {
    throw new TypeError("onMessage must be a function");
  }

  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    attachProtocolStream(socket, {
      onMessage,
      onError: onProtocolError
    });
  });

  const listenOptions = await resolveListenOptions(endpoint, platform);
  await listen(server, listenOptions);

  return {
    endpoint: getServerEndpoint(server, listenOptions),
    server,

    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }

      await closeServer(server);
    }
  };
}

export async function createIpcClient(options = {}) {
  const { endpoint } = options;
  const socket = net.createConnection(toConnectionOptions(endpoint));
  await waitForConnect(socket);

  return {
    socket,

    async send(message) {
      if (!writeProtocolMessage(socket, message)) {
        await once(socket, "drain");
      }
    },

    async close() {
      if (socket.destroyed) {
        return;
      }

      socket.end();
      await once(socket, "close");
    }
  };
}

async function resolveListenOptions(endpoint, platform) {
  if (platform === "test") {
    return {
      type: "tcp",
      host: "127.0.0.1",
      port: 0,
      name: endpoint
    };
  }

  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    throw new Error("endpoint must be a non-empty string");
  }

  if (!endpoint.startsWith("\\\\.\\")) {
    await mkdir(dirname(endpoint), { recursive: true });
  }

  return {
    type: "path",
    path: endpoint
  };
}

function getServerEndpoint(server, listenOptions) {
  if (listenOptions.type === "tcp") {
    const address = server.address();
    return {
      type: "tcp",
      host: address.address,
      port: address.port
    };
  }

  return listenOptions.path;
}

function toConnectionOptions(endpoint) {
  if (typeof endpoint === "string") {
    return { path: endpoint };
  }

  if (endpoint?.type === "tcp") {
    return {
      host: endpoint.host,
      port: endpoint.port
    };
  }

  if (Number.isInteger(endpoint?.port)) {
    return endpoint;
  }

  throw new Error("Unsupported IPC endpoint");
}

function listen(server, listenOptions) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(toServerListenOptions(listenOptions), () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function toServerListenOptions(listenOptions) {
  if (listenOptions.type === "tcp") {
    return {
      host: listenOptions.host,
      port: listenOptions.port
    };
  }

  return listenOptions.path;
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function once(emitter, eventName) {
  return new Promise((resolve) => {
    emitter.once(eventName, resolve);
  });
}

function noop() {}
