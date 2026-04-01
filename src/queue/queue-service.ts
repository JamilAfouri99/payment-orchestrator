import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import type { Logger } from "../core/logger.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";

export type QueueName =
  | "payment-processing"
  | "webhook-delivery"
  | "settlement-calculation"
  | "dunning-retry"
  | "report-generation"
  | "dispute-resolution"
  | "metrics-computation";

export const ALL_QUEUE_NAMES: QueueName[] = [
  "payment-processing",
  "webhook-delivery",
  "settlement-calculation",
  "dunning-retry",
  "report-generation",
  "dispute-resolution",
  "metrics-computation",
];

export interface QueueConfig {
  concurrency: number;
  rateLimitMax?: number | undefined;
  rateLimitDuration?: number | undefined;
}

const DEFAULT_QUEUE_CONFIGS: Record<QueueName, QueueConfig> = {
  "payment-processing": { concurrency: 10, rateLimitMax: 50, rateLimitDuration: 1000 },
  "webhook-delivery": { concurrency: 5, rateLimitMax: 100, rateLimitDuration: 1000 },
  "settlement-calculation": { concurrency: 2 },
  "dunning-retry": { concurrency: 3, rateLimitMax: 10, rateLimitDuration: 1000 },
  "report-generation": { concurrency: 2 },
  "dispute-resolution": { concurrency: 3 },
  "metrics-computation": { concurrency: 1 },
};

export interface JobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface QueueStats {
  name: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export type WorkerProcessor = (job: Job) => Promise<unknown>;

export interface QueueService {
  getQueue(name: QueueName): Queue;
  addJob(queue: QueueName, name: string, data: Record<string, unknown>, opts?: { delay?: number; priority?: number; attempts?: number }): Promise<string>;
  addRepeatable(queue: QueueName, name: string, data: Record<string, unknown>, pattern: string | number): Promise<string>;
  removeRepeatable(queue: QueueName, name: string, pattern: string | number): Promise<void>;
  getQueueStats(): Promise<QueueStats[]>;
  getJobCounts(queue: QueueName): Promise<JobCounts>;
  getFailedJobs(queue: QueueName, limit: number): Promise<{ id: string; name: string; data: unknown; failedReason: string; attemptsMade: number; timestamp: number }[]>;
  retryJob(queue: QueueName, jobId: string): Promise<void>;
  drainQueue(queue: QueueName): Promise<void>;
  pauseQueue(queue: QueueName): Promise<void>;
  resumeQueue(queue: QueueName): Promise<void>;
  registerWorker(queue: QueueName, processor: WorkerProcessor): Worker;
  closeAll(): Promise<void>;
}

export function createQueueService(
  redisUrl: string,
  logger: Logger,
  metrics: MetricsCollector,
): QueueService {
  const connection: ConnectionOptions = { url: redisUrl };
  const queues = new Map<QueueName, Queue>();
  const workers: Worker[] = [];

  function getOrCreateQueue(name: QueueName): Queue {
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      });
      queues.set(name, queue);
    }
    return queue;
  }

  return {
    getQueue(name) {
      return getOrCreateQueue(name);
    },

    async addJob(queueName, name, data, opts) {
      const queue = getOrCreateQueue(queueName);
      const jobOpts: { attempts: number; delay?: number; priority?: number } = {
        attempts: opts?.attempts ?? 3,
      };
      if (opts?.delay !== undefined) jobOpts.delay = opts.delay;
      if (opts?.priority !== undefined) jobOpts.priority = opts.priority;
      const job = await queue.add(name, data, jobOpts);
      metrics.increment("queue_jobs_added", { queue: queueName });
      logger.info("queue_job_added", { queue: queueName, jobName: name, jobId: job.id });
      return job.id ?? "";
    },

    async addRepeatable(queueName, name, data, pattern) {
      const queue = getOrCreateQueue(queueName);
      const repeatOpts = typeof pattern === "number"
        ? { every: pattern }
        : { pattern };
      const job = await queue.add(name, data, { repeat: repeatOpts });
      logger.info("queue_repeatable_added", { queue: queueName, jobName: name, pattern: String(pattern) });
      return job.id ?? "";
    },

    async removeRepeatable(queueName, name, pattern) {
      const queue = getOrCreateQueue(queueName);
      const repeatOpts = typeof pattern === "number"
        ? { every: pattern }
        : { pattern };
      await queue.removeRepeatable(name, repeatOpts);
      logger.info("queue_repeatable_removed", { queue: queueName, jobName: name });
    },

    async getQueueStats() {
      const stats: QueueStats[] = [];
      for (const name of ALL_QUEUE_NAMES) {
        const queue = getOrCreateQueue(name);
        const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
        const isPaused = await queue.isPaused();
        stats.push({
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          paused: isPaused,
        });
      }
      return stats;
    },

    async getJobCounts(queueName) {
      const queue = getOrCreateQueue(queueName);
      const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
      return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        paused: counts.paused ?? 0,
      };
    },

    async getFailedJobs(queueName, limit) {
      const queue = getOrCreateQueue(queueName);
      const jobs = await queue.getFailed(0, limit - 1);
      return jobs.map((job) => ({
        id: job.id ?? "",
        name: job.name,
        data: job.data,
        failedReason: job.failedReason ?? "Unknown",
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
      }));
    },

    async retryJob(queueName, jobId) {
      const queue = getOrCreateQueue(queueName);
      const job = await queue.getJob(jobId);
      if (job) {
        await job.retry();
        metrics.increment("queue_jobs_retried", { queue: queueName });
        logger.info("queue_job_retried", { queue: queueName, jobId });
      }
    },

    async drainQueue(queueName) {
      const queue = getOrCreateQueue(queueName);
      await queue.drain();
      logger.info("queue_drained", { queue: queueName });
    },

    async pauseQueue(queueName) {
      const queue = getOrCreateQueue(queueName);
      await queue.pause();
      logger.info("queue_paused", { queue: queueName });
    },

    async resumeQueue(queueName) {
      const queue = getOrCreateQueue(queueName);
      await queue.resume();
      logger.info("queue_resumed", { queue: queueName });
    },

    registerWorker(queueName, processor) {
      const queueConfig = DEFAULT_QUEUE_CONFIGS[queueName];

      const workerOpts: { connection: ConnectionOptions; concurrency: number; limiter?: { max: number; duration: number } } = {
        connection,
        concurrency: queueConfig.concurrency,
      };

      if (queueConfig.rateLimitMax !== undefined && queueConfig.rateLimitDuration !== undefined) {
        workerOpts.limiter = {
          max: queueConfig.rateLimitMax,
          duration: queueConfig.rateLimitDuration,
        };
      }

      const worker = new Worker(queueName, async (job) => {
        metrics.increment("queue_jobs_processing", { queue: queueName });
        const start = Date.now();
        try {
          const result = await processor(job);
          metrics.increment("queue_jobs_completed", { queue: queueName });
          metrics.recordDuration("queue_job_duration", Date.now() - start, { queue: queueName });
          return result;
        } catch (error) {
          metrics.increment("queue_jobs_failed", { queue: queueName });
          logger.error("queue_job_failed", {
            queue: queueName,
            jobId: job.id,
            jobName: job.name,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }, workerOpts);

      workers.push(worker);
      logger.info("queue_worker_registered", { queue: queueName, concurrency: queueConfig.concurrency });
      return worker;
    },

    async closeAll() {
      const closePromises: Promise<void>[] = [];
      for (const worker of workers) {
        closePromises.push(worker.close());
      }
      for (const queue of queues.values()) {
        closePromises.push(queue.close());
      }
      await Promise.all(closePromises);
      queues.clear();
      workers.length = 0;
      logger.info("queue_service_closed");
    },
  };
}
