import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import type { QueueName } from "../../queue/queue-service.js";
import { ALL_QUEUE_NAMES } from "../../queue/queue-service.js";

export function registerQueueRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/queues", async (_req: Request, res: Response) => {
    if (!deps.queueService) {
      res.json({ queues: [], message: "Queue service not configured" });
      return;
    }
    try {
      const stats = await deps.queueService.getQueueStats();
      res.json({ queues: stats });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get queue stats" });
    }
  });

  router.get("/admin/queues/:name", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    if (!ALL_QUEUE_NAMES.includes(name)) {
      res.status(404).json({ error: `Unknown queue: ${name}` });
      return;
    }
    try {
      const counts = await deps.queueService.getJobCounts(name);
      res.json({ name, ...counts });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get queue stats" });
    }
  });

  router.get("/admin/queues/:name/failed", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    if (!ALL_QUEUE_NAMES.includes(name)) {
      res.status(404).json({ error: `Unknown queue: ${name}` });
      return;
    }
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
    try {
      const failed = await deps.queueService.getFailedJobs(name, limit);
      res.json({ jobs: failed });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get failed jobs" });
    }
  });

  router.post("/admin/queues/:name/retry/:jobId", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    const jobId = String(req.params["jobId"]);
    try {
      await deps.queueService.retryJob(name, jobId);
      res.json({ success: true, queue: name, jobId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to retry job" });
    }
  });

  router.post("/admin/queues/:name/drain", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    try {
      await deps.queueService.drainQueue(name);
      res.json({ success: true, queue: name });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to drain queue" });
    }
  });

  router.post("/admin/queues/:name/pause", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    try {
      await deps.queueService.pauseQueue(name);
      res.json({ success: true, queue: name, paused: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to pause queue" });
    }
  });

  router.post("/admin/queues/:name/resume", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    try {
      await deps.queueService.resumeQueue(name);
      res.json({ success: true, queue: name, paused: false });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to resume queue" });
    }
  });
}
