import { Queue, Worker, type Job } from "bullmq";
import { config } from "../config.js";
import type { EventPayload } from "../schemas/event.schema.js";
import { persistEvent } from "../modules/ingestion/persist-event.js";
import { logger } from "../lib/logger.js";

export const EVENTS_QUEUE_NAME = "rasp-events";

export type EventJobData = {
  payload: EventPayload;
  projectId: string;
  idempotencyKey?: string | null;
};

let queue: Queue<EventJobData> | null = null;
let worker: Worker<EventJobData> | null = null;

function redisConnection() {
  return { url: config.redisUrl };
}

export function isQueueEnabled(): boolean {
  return config.queueEnabled;
}

export function getEventsQueue(): Queue<EventJobData> {
  if (!queue) {
    queue = new Queue<EventJobData>(EVENTS_QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

export async function enqueueEvent(data: EventJobData): Promise<{ jobId: string }> {
  const q = getEventsQueue();
  const jobId = data.idempotencyKey
    ? `${data.projectId}:${data.idempotencyKey}`
    : undefined;
  const job = await q.add("persist", data, jobId ? { jobId } : undefined);
  return { jobId: job.id ?? "unknown" };
}

export function startEventsWorker(): Worker<EventJobData> {
  if (worker) return worker;

  worker = new Worker<EventJobData>(
    EVENTS_QUEUE_NAME,
    async (job: Job<EventJobData>) => {
      const { payload, projectId, idempotencyKey } = job.data;
      const result = await persistEvent(payload, projectId, idempotencyKey);
      logger.info(
        {
          eventId: result.eventId,
          projectId,
          duplicate: result.duplicate ?? false,
          alertCreated: result.alertCreated,
          jobId: job.id,
        },
        "event persisted from queue"
      );
      return result;
    },
    {
      connection: redisConnection(),
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message, attempts: job?.attemptsMade },
      "event job failed"
    );
  });

  return worker;
}

export async function closeQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
