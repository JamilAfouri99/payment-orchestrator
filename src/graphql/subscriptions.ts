export interface PaymentStatusEvent {
  paymentId: string;
  status: string;
  previousStatus?: string | undefined;
  timestamp: string;
}

/**
 * Simple in-process pub/sub for GraphQL subscriptions.
 * Production would use Redis or Kafka.
 */
export function createPubSub() {
  const subscribers = new Set<{
    callback: (event: PaymentStatusEvent) => void;
    paymentIdFilter?: string | undefined;
  }>();

  return {
    publish(event: PaymentStatusEvent): void {
      for (const sub of subscribers) {
        if (!sub.paymentIdFilter || sub.paymentIdFilter === event.paymentId) {
          sub.callback(event);
        }
      }
    },

    subscribe(paymentId?: string | undefined): AsyncIterable<PaymentStatusEvent> {
      const queue: PaymentStatusEvent[] = [];
      let resolve: (() => void) | null = null;

      const sub = {
        callback: (event: PaymentStatusEvent) => {
          queue.push(event);
          if (resolve) {
            resolve();
            resolve = null;
          }
        },
        paymentIdFilter: paymentId,
      };

      subscribers.add(sub);

      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<PaymentStatusEvent>> {
              if (queue.length > 0) {
                return { value: queue.shift()!, done: false };
              }
              await new Promise<void>((r) => { resolve = r; });
              return { value: queue.shift()!, done: false };
            },
            return() {
              subscribers.delete(sub);
              return Promise.resolve({ value: undefined, done: true as const });
            },
          };
        },
      };
    },

    subscriberCount(): number {
      return subscribers.size;
    },
  };
}
