import type { PrismaClient, Prisma } from "@prisma/client";
import { type Result, ok, err } from "../core/result.js";

export interface Snapshot<S> {
  aggregateId: string;
  version: number;
  state: S;
  createdAt: Date;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export interface SnapshotStore<S> {
  /**
   * Saves a snapshot of aggregate state at a given event version.
   * @param aggregateId - The aggregate identifier
   * @param aggregateType - The aggregate type
   * @param version - The event version this snapshot is taken at
   * @param state - The current state to snapshot
   * @returns The saved snapshot or error
   */
  save(
    aggregateId: string,
    aggregateType: string,
    version: number,
    state: S,
  ): Promise<Result<Snapshot<S>, SnapshotError>>;

  /**
   * Loads the latest snapshot for an aggregate.
   * @param aggregateId - The aggregate identifier
   * @returns The snapshot or null if none exists
   */
  load(aggregateId: string): Promise<Result<Snapshot<S> | null, SnapshotError>>;
}

/** Number of events after which a snapshot should be taken */
export const SNAPSHOT_THRESHOLD = 10;

/**
 * Creates a PostgreSQL-backed snapshot store for event sourcing optimization.
 * @param prisma - PrismaClient instance
 * @param tenantId - Tenant scope for all operations
 * @returns SnapshotStore instance
 */
export function createSnapshotStore<S>(prisma: PrismaClient, tenantId: string): SnapshotStore<S> {
  return {
    async save(aggregateId, aggregateType, version, state) {
      try {
        await prisma.eventSnapshot.upsert({
          where: { tenantId_aggregateId: { tenantId, aggregateId } },
          create: {
            tenantId,
            aggregateId,
            aggregateType,
            version,
            state: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue,
          },
          update: {
            version,
            state: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue,
          },
        });

        return ok({ aggregateId, version, state, createdAt: new Date() });
      } catch (error) {
        return err(
          new SnapshotError(
            `Failed to save snapshot: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    },

    async load(aggregateId) {
      try {
        const record = await prisma.eventSnapshot.findUnique({
          where: { tenantId_aggregateId: { tenantId, aggregateId } },
        });

        if (!record) return ok(null);

        return ok({
          aggregateId: record.aggregateId,
          version: record.version,
          state: record.state as S,
          createdAt: record.createdAt,
        });
      } catch (error) {
        return err(
          new SnapshotError(
            `Failed to load snapshot: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    },
  };
}
