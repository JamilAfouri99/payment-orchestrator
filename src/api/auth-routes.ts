import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../core/logger.js";
import type { SessionService } from "../auth/session-service.js";
import { respondProblem } from "./route-helpers.js";
import type { ApiKeyService, GenerateOpts } from "../auth/api-key-service.js";
import type { OnboardingService, KybDetails, ConfigureOpts } from "../auth/onboarding-service.js";
import type { TeamService } from "../auth/team-service.js";

export interface AuthRouteDeps {
  prisma: PrismaClient;
  sessionService: SessionService;
  apiKeyService: ApiKeyService;
  onboardingService: OnboardingService;
  teamService: TeamService;
  logger: Logger;
}

function requireAuth(req: Request, res: Response): string | null {
  const tenantId = req.tenantContext?.tenantId;
  if (tenantId === undefined) {
    respondProblem(res, 401, "Unauthorized", "Authentication is required to access this endpoint");
    return null;
  }
  return tenantId;
}

function requireAdminRole(req: Request, res: Response): boolean {
  const role = req.tenantContext?.userRole;
  if (role !== "owner" && role !== "admin") {
    respondProblem(res, 403, "Forbidden", "Only owners and admins can perform this action");
    return false;
  }
  return true;
}

export function createAuthRoutes(deps: AuthRouteDeps): Router {
  const { sessionService, apiKeyService, onboardingService, teamService, logger } = deps;
  const router = Router();

  // POST /auth/register
  router.post("/auth/register", async (req: Request, res: Response) => {
    const body = req.body as Partial<{
      email: string;
      password: string;
      name: string;
      companyName: string;
      slug: string;
      country: string;
    }>;

    if (!body.email || !body.password || !body.name || !body.companyName || !body.slug || !body.country) {
      respondProblem(res, 400, "Bad Request", "Missing required fields: email, password, name, companyName, slug, country");
      return;
    }

    const result = await sessionService.register(
      body.email,
      body.password,
      body.name,
      body.companyName,
      body.slug,
      body.country,
    );

    if (!result.ok) {
      const code = result.error.code;
      if (code === "EMAIL_TAKEN") {
        respondProblem(res, 409, "Conflict", result.error.message);
        return;
      }
      respondProblem(res, 400, "Registration Failed", result.error.message);
      return;
    }

    const { token, user, tenant, apiKey } = result.value;

    logger.info("user_registered", { userId: user.id, tenantId: tenant.id });

    res.status(201).json({
      token,
      user,
      tenant,
      apiKey: {
        prefix: apiKey.keyPrefix,
        environment: apiKey.environment,
      },
    });
  });

  // POST /auth/login
  router.post("/auth/login", async (req: Request, res: Response) => {
    const body = req.body as Partial<{ email: string; password: string }>;

    if (!body.email || !body.password) {
      respondProblem(res, 400, "Bad Request", "Missing required fields: email, password");
      return;
    }

    const result = await sessionService.login(body.email, body.password);

    if (!result.ok) {
      respondProblem(res, 401, "Unauthorized", result.error.message);
      return;
    }

    res.json({ token: result.value.token, user: result.value.user });
  });

  // GET /auth/me — requires auth via tenantContext (set by JWT or API key middleware upstream)
  router.get("/auth/me", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const userId = req.tenantContext?.userId;
    if (userId === undefined) {
      respondProblem(res, 401, "Unauthorized", "User identity not available in current session");
      return;
    }

    const result = await sessionService.getUser(userId);
    if (!result.ok) {
      if (result.error.code === "USER_NOT_FOUND") {
        respondProblem(res, 404, "Not Found", result.error.message);
        return;
      }
      respondProblem(res, 500, "Internal Error", result.error.message);
      return;
    }

    res.json(result.value);
  });

  // POST /onboarding/kyb
  router.post("/onboarding/kyb", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const body = req.body as Partial<KybDetails>;

    if (!body.businessName || !body.businessType || !body.country) {
      respondProblem(res, 400, "Bad Request", "Missing required fields: businessName, businessType, country");
      return;
    }

    const details: KybDetails = {
      businessName: body.businessName,
      businessType: body.businessType,
      country: body.country,
      ...(body.registrationNumber !== undefined ? { registrationNumber: body.registrationNumber } : {}),
      ...(body.taxId !== undefined ? { taxId: body.taxId } : {}),
      ...(body.website !== undefined ? { website: body.website } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.representativeName !== undefined ? { representativeName: body.representativeName } : {}),
      ...(body.representativeDob !== undefined ? { representativeDob: body.representativeDob } : {}),
    };

    const result = await onboardingService.submitKyb(tenantId, details);
    if (!result.ok) {
      respondProblem(res, 500, "KYB Submission Failed", result.error.message);
      return;
    }

    res.status(201).json(result.value);
  });

  // GET /onboarding/kyb
  router.get("/onboarding/kyb", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const result = await onboardingService.getKybStatus(tenantId);
    if (!result.ok) {
      respondProblem(res, 500, "Internal Error", result.error.message);
      return;
    }

    res.json(result.value);
  });

  // POST /onboarding/configure
  router.post("/onboarding/configure", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const body = req.body as Partial<ConfigureOpts>;

    const config: ConfigureOpts = {
      ...(body.fraudSensitivity !== undefined ? { fraudSensitivity: body.fraudSensitivity } : {}),
      ...(body.settlementCurrency !== undefined ? { settlementCurrency: body.settlementCurrency } : {}),
      ...(body.payoutSchedule !== undefined ? { payoutSchedule: body.payoutSchedule } : {}),
    };

    const result = await onboardingService.configure(tenantId, config);
    if (!result.ok) {
      respondProblem(res, 500, "Configuration Failed", result.error.message);
      return;
    }

    res.json({ success: true });
  });

  // POST /onboarding/go-live
  router.post("/onboarding/go-live", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const result = await onboardingService.goLive(tenantId);
    if (!result.ok) {
      const code = result.error.code;
      if (code === "KYB_NOT_FOUND" || code === "KYB_NOT_APPROVED") {
        respondProblem(res, 422, "Unprocessable Entity", result.error.message);
        return;
      }
      if (code === "ALREADY_LIVE") {
        respondProblem(res, 409, "Conflict", result.error.message);
        return;
      }
      respondProblem(res, 500, "Go-Live Failed", result.error.message);
      return;
    }

    res.json(result.value);
  });

  // POST /api-keys
  router.post("/api-keys", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const body = req.body as Partial<{
      environment: "sandbox" | "production";
      name: string;
      permissions: string[];
    }>;

    if (!body.environment || (body.environment !== "sandbox" && body.environment !== "production")) {
      respondProblem(res, 400, "Bad Request", "Field 'environment' must be 'sandbox' or 'production'");
      return;
    }

    const userId = req.tenantContext?.userId;

    const opts: GenerateOpts = {
      environment: body.environment,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
      ...(userId !== undefined ? { createdBy: userId } : {}),
    };

    const result = await apiKeyService.generate(tenantId, opts);
    if (!result.ok) {
      respondProblem(res, 500, "API Key Generation Failed", result.error.message);
      return;
    }

    const { fullKey, record } = result.value;

    res.status(201).json({
      key: fullKey,
      id: record.id,
      prefix: record.keyPrefix,
      environment: record.environment,
      permissions: record.permissions,
    });
  });

  // GET /api-keys
  router.get("/api-keys", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const result = await apiKeyService.listByTenant(tenantId);
    if (!result.ok) {
      respondProblem(res, 500, "Internal Error", result.error.message);
      return;
    }

    res.json(result.value);
  });

  // DELETE /api-keys/:id
  router.delete("/api-keys/:id", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const keyId = String(req.params["id"]);
    const userId = req.tenantContext?.userId ?? "unknown";

    const result = await apiKeyService.revoke(keyId, userId);
    if (!result.ok) {
      respondProblem(res, 404, "Not Found", result.error.message);
      return;
    }

    res.status(204).end();
  });

  // GET /team
  router.get("/team", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    const result = await teamService.listMembers(tenantId);
    if (!result.ok) {
      respondProblem(res, 500, "Internal Error", result.error.message);
      return;
    }

    res.json(result.value);
  });

  // POST /team/invite
  router.post("/team/invite", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    if (!requireAdminRole(req, res)) return;

    const body = req.body as Partial<{ email: string; role: string }>;

    if (!body.email || !body.role) {
      respondProblem(res, 400, "Bad Request", "Missing required fields: email, role");
      return;
    }

    const userId = req.tenantContext?.userId ?? "unknown";

    const result = await teamService.invite(tenantId, body.email, body.role, userId);
    if (!result.ok) {
      respondProblem(res, 500, "Invite Failed", result.error.message);
      return;
    }

    res.status(201).json(result.value);
  });

  // POST /team/invite/accept — public endpoint, no auth required
  router.post("/team/invite/accept", async (req: Request, res: Response) => {
    const body = req.body as Partial<{ token: string; name: string; password: string }>;

    if (!body.token || !body.name || !body.password) {
      respondProblem(res, 400, "Bad Request", "Missing required fields: token, name, password");
      return;
    }

    const result = await teamService.acceptInvite(body.token, body.name, body.password);
    if (!result.ok) {
      const code = result.error.code;
      if (code === "INVITE_EXPIRED") {
        respondProblem(res, 410, "Gone", result.error.message);
        return;
      }
      if (code === "INVITE_USED") {
        respondProblem(res, 409, "Conflict", result.error.message);
        return;
      }
      respondProblem(res, 500, "Invite Accept Failed", result.error.message);
      return;
    }

    res.json({ userId: result.value.userId, tenantId: result.value.tenantId });
  });

  // PATCH /team/:memberId/role
  router.patch("/team/:memberId/role", async (req: Request, res: Response) => {
    const tenantId = requireAuth(req, res);
    if (tenantId === null) return;

    if (!requireAdminRole(req, res)) return;

    const memberId = String(req.params["memberId"]);
    const body = req.body as Partial<{ role: string }>;

    if (!body.role) {
      respondProblem(res, 400, "Bad Request", "Missing required field: role");
      return;
    }

    const userId = req.tenantContext?.userId ?? "unknown";

    const result = await teamService.changeRole(tenantId, memberId, body.role, userId);
    if (!result.ok) {
      const code = result.error.code;
      if (code === "MEMBER_NOT_FOUND") {
        respondProblem(res, 404, "Not Found", result.error.message);
        return;
      }
      if (code === "INSUFFICIENT_PERMISSION") {
        respondProblem(res, 403, "Forbidden", result.error.message);
        return;
      }
      respondProblem(res, 500, "Role Change Failed", result.error.message);
      return;
    }

    res.json(result.value);
  });

  return router;
}
