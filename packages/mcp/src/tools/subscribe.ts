/**
 * @module tools/subscribe
 * argus_subscribe — Long-poll for SSE-bus events.
 *
 * AI agents can call this to receive a snapshot of recent events on one or
 * more channels plus any new events that arrive within a short wait window.
 * Implementation uses long-polling (not streaming) so it works over MCP stdio
 * and HTTP transports alike.
 */

import type { SSEBus, SSEMessage } from 'argusai-core';
import { EventBus } from 'argusai-core';

export interface SubscribeParams {
  /** Channels to subscribe to (e.g. ['activity', 'build', 'tests']). */
  channels: string[];
  /** Lower-bound timestamp (ms). Events with timestamp < since are skipped. Default: now. */
  since?: number;
  /** Long-poll timeout in ms. New events arriving during this window are returned. Default: 5000. */
  timeoutMs?: number;
  /** Hard cap on returned events. Default: 100. */
  maxEvents?: number;
}

export interface SubscribeEvent {
  channel: string;
  event: string;
  data: unknown;
  timestamp: number;
}

export interface SubscribeResult {
  events: SubscribeEvent[];
  /** True if some events were dropped due to maxEvents limit. */
  hasMore: boolean;
  /** Server-side timestamp for the next `since` value. */
  nextSince: number;
}

/** Default long-poll wait. */
const DEFAULT_TIMEOUT_MS = 5_000;
/** Default max events per response. */
const DEFAULT_MAX_EVENTS = 100;
/** Min poll interval to avoid busy-spinning. */
const POLL_INTERVAL_MS = 50;

export async function handleSubscribe(
  params: SubscribeParams,
  bus?: SSEBus,
): Promise<SubscribeResult> {
  const timeoutMs = Math.min(Math.max(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 0), 30_000);
  const maxEvents = Math.min(Math.max(params.maxEvents ?? DEFAULT_MAX_EVENTS, 1), 1_000);
  const since = params.since ?? Date.now();

  // Replay buffered history first.
  const collected: SubscribeEvent[] = [];
  if (bus instanceof EventBus) {
    for (const channel of params.channels) {
      const replayed = bus.replaySince(channel, since);
      for (const msg of replayed) {
        collected.push(toSubscribeEvent(channel, msg));
      }
    }
  }
  collected.sort((a, b) => a.timestamp - b.timestamp);

  // If we already hit the cap, return immediately.
  if (collected.length >= maxEvents) {
    const trimmed = collected.slice(0, maxEvents);
    return {
      events: trimmed,
      hasMore: true,
      nextSince: trimmed[trimmed.length - 1]!.timestamp,
    };
  }

  // Long-poll: wait up to timeoutMs for new events.
  if (timeoutMs > 0 && bus) {
    await longPoll(bus, params.channels, since, collected, maxEvents, timeoutMs);
  }

  const trimmed = collected.slice(0, maxEvents);
  return {
    events: trimmed,
    hasMore: collected.length > maxEvents,
    nextSince: trimmed.length > 0 ? trimmed[trimmed.length - 1]!.timestamp : since,
  };
}

/**
 * Subscribe to channels and collect events until `maxEvents` is reached or
 * `timeoutMs` elapses. Polling at `POLL_INTERVAL_MS` keeps the wake-up
 * frequency low while still feeling responsive.
 */
async function longPoll(
  bus: SSEBus,
  channels: string[],
  since: number,
  collected: SubscribeEvent[],
  maxEvents: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const unsubs: Array<() => void> = [];

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const u of unsubs) u();
      resolve();
    };

    for (const channel of channels) {
      unsubs.push(
        bus.subscribe(channel, (msg: SSEMessage) => {
          if ((msg.timestamp ?? 0) < since) return;
          collected.push(toSubscribeEvent(channel, msg));
          if (collected.length >= maxEvents) finish();
        }),
      );
    }

    const tick = setInterval(() => {
      if (Date.now() >= deadline || collected.length >= maxEvents) {
        clearInterval(tick);
        finish();
      }
    }, POLL_INTERVAL_MS);
  });
}

function toSubscribeEvent(channel: string, msg: SSEMessage): SubscribeEvent {
  return {
    channel,
    event: msg.event,
    data: msg.data,
    timestamp: msg.timestamp ?? Date.now(),
  };
}