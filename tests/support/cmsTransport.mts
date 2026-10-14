import { EventEmitter } from "node:events";
import net from "node:net";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { Readable } from "node:stream";
import type { TransportRequest } from "../../lib/domain/net/safeFetch.ts";
import type { LookupFn } from "../../lib/domain/net/ssrf.ts";

/**
 * Test double for the pinned transport used by cmsFetch. It runs the real pinned lookup (so the
 * DNS policy is exercised), records what would have been sent, and answers from a route function.
 * Nothing touches the network.
 */

export const PUBLIC_ADDR = "93.184.216.34";

export type Call = { url: string; method: string; headers: Record<string, string>; body?: string; address?: string };
export type Route = { status?: number; body?: unknown; headers?: Record<string, string> };

/** Every name resolves to one public address unless the table says otherwise. */
export function publicLookup(table: Record<string, string[]> = {}): LookupFn {
  return async (host) => (table[host] ?? [PUBLIC_ADDR]).map((address) => ({ address, family: net.isIP(address) }));
}

function pinnedAddress(options: RequestOptions, host: string): Promise<string> {
  if (net.isIP(host)) return Promise.resolve(host);
  const lookup = options.lookup as unknown as (h: string, o: object, cb: (err: Error | null, address?: string) => void) => void;
  return new Promise((resolve, reject) => {
    lookup(host, { all: false }, (err, address) => (err ? reject(err) : resolve(String(address))));
  });
}

class FakeRequest extends EventEmitter {
  destroyed = false;
  run: (chunk: string | undefined) => Promise<void>;
  constructor(run: (chunk: string | undefined) => Promise<void>) {
    super();
    this.run = run;
  }
  end(chunk?: string): void {
    this.run(chunk).catch((err: unknown) => {
      if (!this.destroyed) this.emit("error", err);
    });
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

function fakeResponse(route: Route): IncomingMessage {
  const text = JSON.stringify(route.body ?? {});
  const res = Readable.from([Buffer.from(text)]) as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.headers ?? {})) headers[k.toLowerCase()] = v;
  Object.assign(res, { statusCode: route.status ?? 200, headers });
  return res;
}

/** Returns the calls that reached the "socket" plus the net options to spread into cmsFetch. */
export function fakeFetch(routes: (c: Call) => Route | undefined, lookup: LookupFn = publicLookup()) {
  const calls: Call[] = [];
  const transport: TransportRequest = (options, onResponse) => {
    const host = String(options.hostname);
    const protocol = String(options.protocol);
    const req = new FakeRequest(async (chunk) => {
      const address = await pinnedAddress(options, host);
      const hostPart = net.isIPv6(host) ? `[${host}]` : host;
      const defaultPort = protocol === "https:" ? "443" : "80";
      const portPart = String(options.port) === defaultPort ? "" : `:${options.port}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(options.headers ?? {})) headers[k] = String(v);
      const call: Call = { url: `${protocol}//${hostPart}${portPart}${options.path}`, method: String(options.method), headers, body: chunk, address };
      calls.push(call);
      if (req.destroyed) return;
      onResponse(fakeResponse(routes(call) ?? { status: 404, body: {} }));
    });
    return req as unknown as ClientRequest;
  };
  return { calls, net: { lookup, transport } };
}
