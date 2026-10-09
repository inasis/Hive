import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { A2AAgentToolRuntimePort } from "../../application/ports/a2a-runtime.js";
import { decodePathSegment, readSafeError, sendJson } from "./a2a-http-common.js";
import { A2AMcpHttpHandler } from "./a2a-mcp-http-handler.js";
import { A2AMcpToolDispatcher } from "./a2a-mcp-tool-dispatcher.js";
import { A2AV1HttpHandler, type A2AV1HttpRuntimePort } from "./a2a-v1-http-handler.js";

type A2AHttpServerRuntimePort = A2AV1HttpRuntimePort & A2AAgentToolRuntimePort;

export type A2AHttpServerOptions = {
  host: string;
  port: number;
  bearerToken: string;
  tlsFiles?: { certificatePath: string; privateKeyPath: string };
  maxRequestBytes?: number;
  heartbeatIntervalMs?: number;
};

/** Owns the authenticated HTTP listener and dispatches traffic to protocol handlers. */
export class A2AHttpServer {
  private server: Server | undefined;
  private readonly mcpHandler: A2AMcpHttpHandler;
  private readonly v1Handler: A2AV1HttpHandler;

  constructor(
    private readonly runtime: A2AHttpServerRuntimePort,
    private readonly options: A2AHttpServerOptions,
  ) {
    if (!options.host.trim()) throw new Error("A2A HTTP host must be non-empty");
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) throw new Error("A2A HTTP port is invalid");
    if (options.bearerToken.trim().length < 32) throw new Error("A2A HTTP bearer token must contain at least 32 characters");
    if (Boolean(options.tlsFiles?.certificatePath) !== Boolean(options.tlsFiles?.privateKeyPath)) {
      throw new Error("Configure both A2A TLS certificate and private key paths");
    }
    if (!options.tlsFiles && !isLoopbackHost(options.host)) {
      throw new Error("A2A HTTP requires TLS when binding to a non-loopback address");
    }
    const maxRequestBytes = options.maxRequestBytes ?? 1_048_576;
    this.mcpHandler = new A2AMcpHttpHandler(new A2AMcpToolDispatcher(runtime), maxRequestBytes);
    this.v1Handler = new A2AV1HttpHandler(runtime, maxRequestBytes, options.heartbeatIntervalMs ?? 20_000);
  }

  async listen(): Promise<void> {
    if (this.server) throw new Error("A2A HTTP server is already listening");
    const handler = (request: IncomingMessage, response: ServerResponse): void => {
      void this.handle(request, response);
    };
    const server = this.options.tlsFiles
      ? createHttpsServer({
          cert: await readFile(this.options.tlsFiles.certificatePath),
          key: await readFile(this.options.tlsFiles.privateKeyPath),
        }, handler)
      : createServer(handler);
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        this.server = undefined;
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.port, this.options.host);
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    this.v1Handler.closeEventStreams();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (!this.isAuthorized(request)) {
      sendJson(response, 401, { error: { code: "UNAUTHORIZED", message: "A valid bearer token is required." } });
      return;
    }
    if (request.url === undefined) {
      sendJson(response, 400, { error: { code: "INVALID_REQUEST", message: "Request URL is missing." } });
      return;
    }

    let pathname: string;
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url, "http://localhost");
      pathname = requestUrl.pathname;
    } catch {
      sendJson(response, 400, { error: { code: "INVALID_REQUEST", message: "Request URL is invalid." } });
      return;
    }

    try {
      if (pathname === "/mcp") {
        await this.mcpHandler.handle(request, response, requestUrl);
        return;
      }
      const segments = pathname.split("/").filter(Boolean).map(decodePathSegment);
      if (segments[0] !== "v1") {
        sendJson(response, 404, { error: { code: "NOT_FOUND", message: "A2A endpoint was not found." } });
        return;
      }
      await this.v1Handler.handle(request, response, segments.slice(1));
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const detail = readSafeError(error);
      sendJson(response, detail.status, { error: detail.body });
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
    const token = Buffer.from(authorization.slice(7), "utf8");
    const expected = Buffer.from(this.options.bearerToken, "utf8");
    return token.length === expected.length && timingSafeEqual(token, expected);
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}
