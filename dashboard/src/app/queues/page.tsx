"use client";

import { useEffect, useState } from "react";
import {
  fetchQueueStats,
  fetchFailedJobs,
  retryQueueJob,
  pauseQueue,
  resumeQueue,
  type QueueStats,
  type FailedJob,
} from "@/lib/api";

const QUEUE_COLORS: Record<string, string> = {
  "payment-processing": "text-accent",
  "webhook-delivery": "text-success",
  "settlement-calculation": "text-warning",
  "dunning-retry": "text-danger",
  "report-generation": "text-muted",
  "dispute-resolution": "text-danger",
  "metrics-computation": "text-accent",
};

const QUEUE_DESCRIPTIONS: Record<string, string> = {
  "payment-processing": "Saga step execution for payment flows",
  "webhook-delivery": "Webhook sending with retries and DLQ",
  "settlement-calculation": "Periodic settlement aggregation jobs",
  "dunning-retry": "Subscription payment retry scheduling",
  "report-generation": "Async report building (CSV/JSON)",
  "dispute-resolution": "Simulated dispute lifecycle progression",
  "metrics-computation": "Periodic analytics metric calculation",
};

export default function QueuesPage() {
  const [queues, setQueues] = useState<QueueStats[]>([]);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQueues = () => {
    fetchQueueStats()
      .then((data) => setQueues(data.queues))
      .catch(() => setError("Failed to load queue stats — Redis may not be running"));
  };

  useEffect(() => {
    loadQueues();
    const interval = setInterval(loadQueues, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedQueue) {
      fetchFailedJobs(selectedQueue)
        .then((data) => setFailedJobs(data.jobs))
        .catch(() => setFailedJobs([]));
    } else {
      setFailedJobs([]);
    }
  }, [selectedQueue]);

  const totalWaiting = queues.reduce((s, q) => s + q.waiting, 0);
  const totalActive = queues.reduce((s, q) => s + q.active, 0);
  const totalFailed = queues.reduce((s, q) => s + q.failed, 0);
  const totalCompleted = queues.reduce((s, q) => s + q.completed, 0);

  async function handleTogglePause(name: string, paused: boolean) {
    try {
      if (paused) {
        await resumeQueue(name);
        setMessage(`Queue "${name}" resumed`);
      } else {
        await pauseQueue(name);
        setMessage(`Queue "${name}" paused`);
      }
      loadQueues();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function handleRetry(queue: string, jobId: string) {
    try {
      await retryQueueJob(queue, jobId);
      setMessage(`Job ${jobId} retried`);
      const data = await fetchFailedJobs(queue);
      setFailedJobs(data.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Queue Management</h1>
        <p className="text-muted text-sm mt-1">
          BullMQ job queues for async processing — payment sagas, webhooks, settlements, dunning, reports, disputes, and analytics
        </p>
      </div>

      {message && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-success text-sm flex justify-between items-center">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-success/70 hover:text-success">x</button>
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-danger text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-danger/70 hover:text-danger">x</button>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4">
          <p className="text-xs text-muted">Waiting</p>
          <p className="text-2xl font-bold text-warning">{totalWaiting}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <p className="text-xs text-muted">Active</p>
          <p className="text-2xl font-bold text-accent">{totalActive}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <p className="text-xs text-muted">Completed</p>
          <p className="text-2xl font-bold text-success">{totalCompleted}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <p className="text-xs text-muted">Failed</p>
          <p className="text-2xl font-bold text-danger">{totalFailed}</p>
        </div>
      </div>

      {/* Queue Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {queues.map((q) => (
          <button
            key={q.name}
            onClick={() => setSelectedQueue(selectedQueue === q.name ? null : q.name)}
            className={`bg-card border rounded-xl p-4 text-left transition-colors ${
              selectedQueue === q.name ? "border-accent" : "border-card-border hover:border-card-border/70"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-mono font-medium ${QUEUE_COLORS[q.name] ?? "text-foreground"}`}>
                {q.name}
              </span>
              {q.paused && (
                <span className="text-xs bg-warning/15 text-warning px-2 py-0.5 rounded">paused</span>
              )}
            </div>
            <p className="text-xs text-muted mb-3 line-clamp-1">
              {QUEUE_DESCRIPTIONS[q.name] ?? ""}
            </p>
            <div className="grid grid-cols-4 gap-1 text-center">
              <div>
                <p className="text-xs text-muted">Wait</p>
                <p className="text-sm font-bold">{q.waiting}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Act</p>
                <p className="text-sm font-bold text-accent">{q.active}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Done</p>
                <p className="text-sm font-bold text-success">{q.completed}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Fail</p>
                <p className="text-sm font-bold text-danger">{q.failed}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Selected Queue Detail */}
      {selectedQueue && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-card-border flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{selectedQueue}</h3>
              <p className="text-xs text-muted">{QUEUE_DESCRIPTIONS[selectedQueue] ?? ""}</p>
            </div>
            <div className="flex gap-2">
              {queues.find((q) => q.name === selectedQueue) && (
                <button
                  onClick={() => {
                    const q = queues.find((q) => q.name === selectedQueue);
                    if (q) handleTogglePause(q.name, q.paused);
                  }}
                  className={`px-3 py-1 rounded text-xs font-medium ${
                    queues.find((q) => q.name === selectedQueue)?.paused
                      ? "bg-success/15 text-success hover:bg-success/25"
                      : "bg-warning/15 text-warning hover:bg-warning/25"
                  }`}
                >
                  {queues.find((q) => q.name === selectedQueue)?.paused ? "Resume" : "Pause"}
                </button>
              )}
            </div>
          </div>

          {/* Failed Jobs Table */}
          <div className="p-4">
            <h4 className="text-sm font-semibold mb-3">
              Failed Jobs ({failedJobs.length})
            </h4>
            {failedJobs.length === 0 ? (
              <p className="text-sm text-muted">No failed jobs in this queue</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted border-b border-card-border">
                      <th className="pb-2 font-medium">Job ID</th>
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Reason</th>
                      <th className="pb-2 font-medium">Attempts</th>
                      <th className="pb-2 font-medium">Time</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedJobs.map((job) => (
                      <tr key={job.id} className="border-b border-card-border last:border-0">
                        <td className="py-2 font-mono text-xs text-accent">{job.id}</td>
                        <td className="py-2 text-xs">{job.name}</td>
                        <td className="py-2 text-xs text-danger max-w-[200px] truncate">{job.failedReason}</td>
                        <td className="py-2 text-xs">{job.attemptsMade}</td>
                        <td className="py-2 text-xs text-muted">
                          {new Date(job.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => handleRetry(selectedQueue, job.id)}
                            className="px-2 py-1 bg-accent/15 text-accent rounded text-xs hover:bg-accent/25"
                          >
                            Retry
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Architecture Info */}
      {queues.length === 0 && !error && (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <svg className="w-12 h-12 text-muted mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p className="text-muted text-sm">Loading queue stats...</p>
          <p className="text-muted text-xs mt-1">Requires Redis to be running</p>
        </div>
      )}
    </div>
  );
}
