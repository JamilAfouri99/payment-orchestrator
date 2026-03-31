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
  /**
   * Appends an event to the store with optimistic locking.
   * @param event - The event to append (id and createdAt are generated)
   * @returns The persisted event or an error if version conflicts
   */
  append(event: Omit<DomainEvent, "id" | "createdAt">): Promise<Result<DomainEvent, EventStoreError>>;

  /**
   * Retrieves all events for a given aggregate in version order.
   * @param aggregateId - The aggregate to query
   * @returns Ordered list of events
   */
  getByAggregateId(aggregateId: string): Promise<Result<DomainEvent[], EventStoreError>>;

  /**
   * Replays all events for an aggregate through a reducer to derive current state.
   * @param aggregateId - The aggregate to replay
   * @param reducer - Function that folds events into state
   * @param initialState - Starting state before any events
   * @returns The derived state
   */
  replay<S>(
    aggregateId: string,
    reducer: (state: S, event: DomainEvent) => S,
    initialState: S,
  ): Promise<Result<S, EventStoreError>>;
}

/**
 * Creates a PostgreSQL-backed event store with optimistic locking.
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

    async replay<S>(
      aggregateId: string,
      reducer: (state: S, event: DomainEvent) => S,
      initialState: S,
    ): Promise<Result<S, EventStoreError>> {
      const eventsResult = await this.getByAggregateId(aggregateId);
      if (!eventsResult.ok) return eventsResult;
      const state = eventsResult.value.reduce(reducer, initialState);
      return ok(state);
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
