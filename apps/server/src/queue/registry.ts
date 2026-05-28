import { Queue, QueueOptions } from "bullmq";
import { Redis } from "ioredis";

// Validate queue name meets `<capability>:<job-kind>` pattern (lowercase alphanumeric and hyphens)
const VALID_QUEUE_NAME = /^[a-z0-9-]+:[a-z0-9-]+$/;

export class QueueRegistry {
  private static queues = new Map<string, Queue>();
  private static connection: Redis;

  static setConnection(connection: Redis) {
    this.connection = connection;
  }

  static register(name: string, opts?: Omit<QueueOptions, "connection">): Queue {
    if (!VALID_QUEUE_NAME.test(name)) {
      throw new Error(`Invalid queue name format: "${name}". Expected "<capability>:<job-kind>" (lowercase alphanumeric and hyphens).`);
    }

    if (this.queues.has(name)) {
      return this.queues.get(name)!;
    }

    if (!this.connection) {
      throw new Error("QueueRegistry connection not set. Call QueueRegistry.setConnection() first.");
    }

    // BullMQ forbids `:` in queue names. We translate it to `__` internally.
    const bullName = name.replace(":", "__");
    const queue = new Queue(bullName, {
      ...opts,
      connection: this.connection as any,
    });

    this.queues.set(name, queue);
    return queue;
  }

  static get(name: string): Queue {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue "${name}" is not registered.`);
    }
    return queue;
  }

  static getAll(): Queue[] {
    return Array.from(this.queues.values());
  }

  static async closeAll() {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();
  }
}
