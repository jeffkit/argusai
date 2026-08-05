/**
 * @module sse-bus
 * In-process event bus for Server-Sent Events (SSE) broadcasting.
 *
 * Provides a lightweight pub/sub system keyed by channel names.
 * Designed to feed real-time events to the dashboard via SSE and to
 * power long-poll style MCP subscriptions.
 */

import type { SSEBus, SSEMessage } from './types.js';

/**
 * In-process event bus implementing {@link SSEBus}.
 *
 * Usage:
 * ```ts
 * const bus = createEventBus();
 * const unsub = bus.subscribe('tests', (msg) => console.log(msg));
 * bus.emit('tests', { event: 'case_pass', data: { name: 'health' } });
 * unsub(); // unsubscribe
 * ```
 */
export class EventBus implements SSEBus {
  private listeners = new Map<string, Set<(msg: SSEMessage) => void>>();
  /** Ring buffer per channel — used for `subscribeSince()` history replay. */
  private history = new Map<string, SSEMessage[]>();
  /** Max events kept per channel. Older events are dropped FIFO. */
  private static readonly HISTORY_CAPACITY = 200;

  /**
   * Emit a message to all subscribers of a channel.
   *
   * @param channel - Channel name
   * @param message - SSE message to broadcast
   */
  emit(channel: string, message: SSEMessage): void {
    const subs = this.listeners.get(channel);
    if (subs) {
      for (const handler of subs) {
        handler(message);
      }
    }
    // Append to ring buffer for late subscribers.
    let buf = this.history.get(channel);
    if (!buf) {
      buf = [];
      this.history.set(channel, buf);
    }
    buf.push(message);
    if (buf.length > EventBus.HISTORY_CAPACITY) {
      buf.shift();
    }
  }

  /**
   * Subscribe to a channel.
   *
   * @param channel - Channel name
   * @param handler - Callback invoked for each message on the channel
   * @returns An unsubscribe function
   */
  subscribe(channel: string, handler: (msg: SSEMessage) => void): () => void {
    let subs = this.listeners.get(channel);
    if (!subs) {
      subs = new Set();
      this.listeners.set(channel, subs);
    }
    subs.add(handler);

    return () => {
      subs.delete(handler);
      if (subs.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  /**
   * Replay buffered events for `channel` whose timestamp >= `sinceMs`.
   * Used by `argus_subscribe` to give late subscribers a short history.
   *
   * @param channel - Channel name
   * @param sinceMs - Lower-bound timestamp in ms (inclusive)
   * @returns Array of buffered events, oldest first
   */
  replaySince(channel: string, sinceMs: number): SSEMessage[] {
    const buf = this.history.get(channel);
    if (!buf) return [];
    return buf.filter((m) => (m.timestamp ?? 0) >= sinceMs);
  }

  /**
   * Get the number of subscribers for a channel.
   *
   * @param channel - Channel name
   * @returns Number of active subscribers
   */
  subscriberCount(channel: string): number {
    return this.listeners.get(channel)?.size ?? 0;
  }

  /**
   * Remove all subscriptions and buffered history from all channels.
   */
  clear(): void {
    this.listeners.clear();
    this.history.clear();
  }
}

/**
 * Create a new {@link EventBus} instance.
 *
 * @returns A fresh EventBus
 */
export function createEventBus(): EventBus {
  return new EventBus();
}
