import Dexie, { Table } from "dexie";

export interface QueuedEvent {
  eventId: string;
  matchId: string;
  path: string;
  body: unknown;
  createdAt: number;
  synced: number;
}

class UmpireDB extends Dexie {
  queue!: Table<QueuedEvent, string>;
  constructor() {
    super("wolfpack-umpire");
    this.version(1).stores({
      queue: "eventId, matchId, synced, createdAt"
    });
  }
}

export const db = new UmpireDB();

export async function enqueue(ev: Omit<QueuedEvent, "synced" | "createdAt">) {
  await db.queue.put({ ...ev, synced: 0, createdAt: Date.now() });
}

export async function dropQueued(eventId: string) {
  await db.queue.delete(eventId);
}

export async function flushQueue(send: (ev: QueuedEvent) => Promise<void>) {
  const pending = await db.queue.where("synced").equals(0).sortBy("createdAt");
  for (const ev of pending) {
    try {
      await send(ev);
      await db.queue.update(ev.eventId, { synced: 1 });
    } catch {
      break;
    }
  }
}
