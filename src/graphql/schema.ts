export const typeDefs = /* GraphQL */ `
  type Query {
    payment(id: ID!): Payment
    payments(first: Int = 20, after: String, status: String): PaymentConnection!
    paymentEvents(paymentId: ID!): [DomainEvent!]!
    providers: [Provider!]!
    fraudRules: [FraudRule!]!
    fxRates: [FxRate!]!
    declineCodes: [DeclineCode!]!
    metrics: MetricsSnapshot!
  }

  type Mutation {
    createPayment(input: CreatePaymentInput!): Payment!
    registerWebhook(url: String!, events: [String!]): WebhookRegistration!
    upsertFraudRule(input: FraudRuleInput!): FraudRule!
    deleteFraudRule(id: ID!): Boolean!
    updateChaos(service: String!, failureRate: Float, latencyMs: Int, enabled: Boolean): ChaosConfig!
    revokeToken(token: String!): Boolean!
    updateFxRate(from: String!, to: String!, rate: Float!, spreadBps: Int!): FxRate!
  }

  type Subscription {
    paymentStatusChanged(paymentId: ID): PaymentStatusEvent!
  }

  type Payment {
    id: ID!
    status: String!
    amount: Int!
    currency: String!
    customerId: String!
    orderId: String!
    region: String
    providerId: String
    tokenId: String
    fraudScore: Int
    fraudAction: String
    declineCode: String
    fxRate: Float
    fxOriginalAmount: Int
    fxOriginalCurrency: String
    error: String
    createdAt: String!
    updatedAt: String!
    items: [OrderItem!]!
    events: [DomainEvent!]!
  }

  type OrderItem {
    productId: String!
    quantity: Int!
    pricePerUnit: Int!
  }

  type DomainEvent {
    id: ID!
    aggregateId: String!
    eventType: String!
    version: Int!
    payload: JSON!
    createdAt: String!
  }

  type PaymentConnection {
    edges: [PaymentEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type PaymentEdge {
    node: Payment!
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type Provider {
    name: String!
    supportedCurrencies: [String!]!
    supportedRegions: [String!]!
    costBasisPoints: Int!
    settlementCurrency: String!
    circuitBreakerState: String!
    priority: Int!
  }

  type FraudRule {
    id: ID!
    name: String!
    description: String!
    ruleType: String!
    config: JSON!
    weight: Int!
    enabled: Boolean!
  }

  type FxRate {
    fromCurrency: String!
    toCurrency: String!
    rate: Float!
    spreadBps: Int!
    updatedAt: String!
  }

  type DeclineCode {
    code: String!
    category: String!
    description: String!
    retryable: Boolean!
    suggestedAction: String!
    maxRetries: Int!
  }

  type MetricsSnapshot {
    counters: JSON!
    histograms: JSON!
    collectedAt: String!
  }

  type WebhookRegistration {
    id: ID!
    url: String!
    events: [String!]!
  }

  type ChaosConfig {
    services: JSON!
  }

  type PaymentStatusEvent {
    paymentId: String!
    status: String!
    previousStatus: String
    timestamp: String!
  }

  input CreatePaymentInput {
    amount: Int!
    currency: String!
    customerId: String!
    orderId: String!
    region: String
    token: String
    items: [OrderItemInput!]!
  }

  input OrderItemInput {
    productId: String!
    quantity: Int!
    pricePerUnit: Int!
  }

  input FraudRuleInput {
    id: ID
    name: String!
    description: String!
    ruleType: String!
    config: JSON
    weight: Int!
    enabled: Boolean!
  }

  scalar JSON
`;
