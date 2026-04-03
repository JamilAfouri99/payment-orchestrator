export function problemResponse(detail: string): Record<string, unknown> {
  return {
    description: detail,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ProblemDetails" },
      },
    },
  };
}

export function jsonBody(
  schema: Record<string, unknown>,
  example?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    required: true,
    content: {
      "application/json": {
        schema,
        ...(example !== undefined ? { example } : {}),
      },
    },
  };
}

export function jsonResponse(
  description: string,
  schema: Record<string, unknown>,
  example?: unknown,
): Record<string, unknown> {
  return {
    description,
    content: {
      "application/json": {
        schema,
        ...(example !== undefined ? { example } : {}),
      },
    },
  };
}

export function pathParam(name: string, description: string): Record<string, unknown> {
  return { name, in: "path", required: true, schema: { type: "string" }, description };
}

export function queryParam(
  name: string,
  description: string,
  type: string = "string",
  defaultValue?: unknown,
): Record<string, unknown> {
  return {
    name,
    in: "query",
    required: false,
    schema: { type, ...(defaultValue !== undefined ? { default: defaultValue } : {}) },
    description,
  };
}
