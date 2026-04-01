import { Router, type Request, type Response } from "express";
import { buildOpenAPISpec } from "./openapi-spec.js";

/**
 * Creates Express router for API documentation endpoints.
 * Serves OpenAPI spec, Swagger UI, and Redoc.
 */
export function createDocsRoutes(): Router {
  const router = Router();
  const spec = buildOpenAPISpec();

  // Raw OpenAPI JSON spec
  router.get("/openapi.json", (_req: Request, res: Response) => {
    res.json(spec);
  });

  // Swagger UI — served via CDN (no npm dependency required)
  router.get("/docs", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.send(SWAGGER_UI_HTML);
  });

  // Redoc — served via CDN
  router.get("/redoc", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.send(REDOC_HTML);
  });

  return router;
}

const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Orchestrator — API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; background: #0b1120; }
    .swagger-ui .topbar { display: none; }
    #swagger-ui { max-width: 1200px; margin: 0 auto; padding: 20px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;

const REDOC_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Orchestrator — API Reference</title>
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <redoc spec-url="/openapi.json" hide-hostname></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`;
