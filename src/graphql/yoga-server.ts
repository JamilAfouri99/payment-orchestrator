import { createSchema, createYoga } from "graphql-yoga";
import { typeDefs } from "./schema.js";
import { createResolvers, type ResolverDeps } from "./resolvers.js";

export function createGraphQLHandler(deps: ResolverDeps) {
  const resolvers = createResolvers(deps);

  const yoga = createYoga({
    schema: createSchema({
      typeDefs,
      resolvers,
    }),
    graphqlEndpoint: "/graphql",
    landingPage: true,
  });

  return yoga;
}
