import { PrismaClient, Prisma } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { DomainEvent, PaymentEventType } from "../core/types.js";

export class EventStoreError extends Error {
  constructor(
    message: string,
    public readonly code: "OPTIMISTIC_LOCK" | "STORE_FAILURE",
  ) {
    super(message);
    this.name = "EventStoreError";
  }
}

export interface EventStore {
  /** Appends an event with optimistic locking via unique version constraint */
  append(event: Omit<DomainEvent, "id" | "createdAt">): Promise<Result<DomainEvent, EventStoreError>>;

  /** Retrieves all events for an aggregate in version order */
  getByAggregateId(aggregateId: string): Promise<Result<DomainEvent[], EventStoreError>>;

  /** Retrieves events up to a specific point in time (temporal query) */
  getByAggregateIdAt(aggregateId: string, at: Date): Promise<Result<DomainEvent[], EventStoreError>>;

  /** Retrieves events after a specific version (for snapshot + replay) */
  getAfterVersion(aggregateId: string, version: number): Promise<Result<DomainEvent[], EventStoreError>>;

  /** Replays all events through a reducer to derive current state */
  replay<S>(
    aggregateId: string,
    reducer: (state: S, event: DomainEvent) => S,
    initialState: S,
  ): Promise<Result<S, EventStoreError>>;

  /** Replays events up to a point in time through a reducer */
  replayAt<S>(
    aggregateId: string,
    at: Date,
    reducer: (state: S, event: DomainEvent) => S,
    initialState: S,
  ): Promise<Result<S, EventStoreError>>;

  /** Returns all unique aggregate IDs with optional pagination */
  listAggregates(limit: number, offset: number): Promise<Result<string[], EventStoreError>>;

  /** Returns total count of distinct aggregates */
  countAggregates(): Promise<Result<number, EventStoreError>>;
}

/**
 * Creates a PostgreSQL-backed event store with optimistic locking and temporal queries.
 * @param prisma - PrismaClient instance
 * @returns EventStore implementation
 */
export function createEventStore(prisma: PrismaClient): EventStore {
  return {
    async append(event) {
      try {
        const record = await prisma.eventStore.create({
          data: {
            id: uuid(),
            aggregateId: event.aggregateId,
            aggregateType: event.aggregateType,
            eventType: event.eventType,
            version: event.version,
            payload: event.payload as Prisma.InputJsonValue,
            metadata: event.metadata as Prisma.InputJsonValue,
          },
        });
        return ok(toDomainEvent(record));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return err(
            new EventStoreError(
              `Optimistic lock conflict: version ${event.version} already exists for aggregate ${event.aggregateId}`,
              "OPTIMISTIC_LOCK",
            ),
          );
        }
        return err(
          new EventStoreError(
            `Failed to append event: ${error instanceof Error ? error.message : String(error)}`,
            "STORE_FAILURE",
          ),
        );
      }
    },

    async getByAggregateId(aggregateId) {
      try {
        const records = await prisma.eventStore.findMany({
          where: { aggregateId },
          orderBy: { version: "asc" },
        });
        return ok(records.map(toDomainEvent));
      } catch (error) {
        return err(
          new EventStoreError(
            `Failed to query events: ${error instanceof Error ? error.message : String(error)}`,
            "STORE_FAILURE",
          ),
        );
      }
    },

    async getByAggregateIdAt(aggregateId, at) {
      try {
        const records = await prisma.eventStore.findMany({
          where: { aggregateId, createdAt: { lte: at } },
          orderBy: { version: "asc" },
        });
        return ok(records.map(toDomainEvent));
      } catch (error) {
        return err(
          new EventStoreError(
            `Failed to query events at time: ${error instanceof Error ? error.message : String(error)}`,
            "STORE_FAILURE",
          ),
        );
      }
    },

    async getAfterVersion(aggregateId, version) {
      try {
        const records = await prisma.eventStore.findMany({
          where: { aggregateId, version: { gt: version } },
          orderBy: { version: "asc" },
        });
        return ok(records.map(toDomainEvent));
      } catch (error) {
        return err(
          new EventStoreError(
            `Failed to query events after version: ${error instanceof Error ? error.message : String(error)}`,
            "STORE_FAILURE",
          ),
        );
      }
    },

    async replay<S>(
      aggregateId: string,
      reducer: (state: S, event: DomainEvent) => S,
      initialState: S,
    ): Promise<Result<S, EventStoreError>> {
      const eventsResult = await this.getByAggregateId(aggregateId);
      if (!eventsResult.ok) return eventsResult;
      return ok(eventsResult.value.reduce(reducer, initialState));
    },

    async replayAt<S>(
      aggregateId: string,
      at: Date,
      reducer: (state: S, event: DomainEvent) => S,
      initialState: S,
    ): Promise<Result<S, EventStoreError>> {
      const eventsResult = await this.getByAggregateIdAt(aggregateId, at);
      if (!eventsResult.ok) return eventsResult;
      return ok(eventsResult.value.reduce(reducer, initialState));
    },

    async listAggregates(limit, offset) {
      try {
        const results = await prisma.eventStore.findMany({
          where: { version: 1 },
          orderBy: { createdAt: "desc" },
          select: { aggregateId: true },
          take: limit,
          skip: offset,
        });
        return ok(results.map((r) => r.aggregateId));
      } catch (error) {
        return err(
          new EventStoreError(
            `Failed to list aggregates: ${error instanceof Error ? error.message : String(error)}`,
            "STORE_FAILURE",
          ),
        );
      }
    },

    async countAggregates() {
      try {
        const count = await prisma.eventStore.count({ where: { version: 1 } });
        return ok(count);
      } catch (error) {
        return err(
          new EventStoreError(
            `Failed to count aggregates: ${error instanceof Error ? error.message : String(error)}`,
            "STORE_FAILURE",
          ),
        );
      }
    },
  };
}

function toDomainEvent(record: {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  version: number;
  payload: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}): DomainEvent {
  return {
    id: record.id,
    aggregateId: record.aggregateId,
    aggregateType: record.aggregateType,
    eventType: record.eventType as PaymentEventType,
    version: record.version,
    payload: record.payload as Record<string, unknown>,
    metadata: record.metadata as Record<string, unknown>,
    createdAt: record.createdAt,
  };
}
