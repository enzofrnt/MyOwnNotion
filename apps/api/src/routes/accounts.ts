/**
 * Account routes (feature 058): first launch, sign-up, the signed-in account,
 * and administration.
 *
 * Administration answers members exactly like an unknown route (404), so a
 * member learns nothing about what the administrator can do.
 */

import {
  AccountSessionSchema,
  type AdminAccountCreateDto,
  AdminAccountCreateSchema,
  type AdminAccountDeleteDto,
  AdminAccountDeleteSchema,
  AdminAccountListSchema,
  AdminAccountViewSchema,
  type AdminPasswordResetDto,
  AdminPasswordResetSchema,
  type BootstrapAccountDto,
  BootstrapAccountSchema,
  type InvitationCreateDto,
  InvitationCreatedSchema,
  InvitationCreateSchema,
  InvitationListSchema,
  MeSchema,
  type MeUpdateDto,
  MeUpdateSchema,
  type RegistrationSettingsDto,
  RegistrationSettingsSchema,
  SecurityProblemSchema,
  type SignupDto,
  SignupSchema,
} from "@myownnotion/contracts";
import type { AccountRecord, Database } from "@myownnotion/database";
import { findInstallation, recordDeviceActivity } from "@myownnotion/database";
import type { SafeProblemCode } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendSecurityProblem, toSecurityProblem } from "../plugins/errors.ts";
import { AccountRefusedError, type AccountService } from "../security/account-service.ts";
import { setSessionCookie } from "../security/cookie-policy.ts";
import { deriveCsrfToken } from "../security/csrf.ts";
import { KeyUnavailableError } from "../security/key-hierarchy.ts";
import { WeakPasswordError } from "../security/password-service.ts";
import { type RequestPrincipal, requestContext } from "../security/request-context.ts";
import type { SecurityConfig } from "../security/security-config.ts";
import type { IssuedSession } from "../security/session-service.ts";
import type { AuthenticationGate } from "./authentication.ts";

type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;

const AccountParams = Type.Object({ accountId: Type.String({ format: "uuid" }) });
const InvitationParams = Type.Object({ invitationId: Type.String({ format: "uuid" }) });

export interface AccountRouteDeps {
  readonly db: Database;
  readonly config: SecurityConfig;
  readonly accounts: AccountService;
  readonly require: AuthenticationGate;
  readonly deploymentKey: () => Buffer | null;
  readonly publicOrigin: string;
  readonly now: () => Date;
}

export function me(account: AccountRecord) {
  return {
    accountId: account.id,
    email: account.email,
    pseudonym: account.pseudonym,
    role: account.role,
  };
}

function adminView(account: AccountRecord) {
  return {
    ...me(account),
    origin: account.origin,
    state: account.state,
    invitationId: account.invitationId,
    createdAt: account.createdAt.toISOString(),
  };
}

const ERROR_CODES: Record<AccountRefusedError["code"], SafeProblemCode> = {
  already_initialized: "already_initialized",
  registration_closed: "registration_closed",
  invitation_unavailable: "invitation_unavailable",
  email_unavailable: "email_unavailable",
  not_found: "not_found",
  conflict: "conflict",
};

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const correlation = (request: FastifyRequest) => requestContext(request).correlationId;

  const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if (error instanceof AccountRefusedError)
      return sendSecurityProblem(reply, {
        code: ERROR_CODES[error.code],
        correlationId: correlation(request),
      });
    // No mounted deployment key: no account can be given keys, and saying so
    // is the honest answer — the installation is degraded, not the request.
    if (error instanceof KeyUnavailableError)
      return sendSecurityProblem(reply, {
        code: "installation_degraded",
        correlationId: correlation(request),
      });
    if (error instanceof WeakPasswordError)
      return sendSecurityProblem(reply, {
        code: "validation_failed",
        correlationId: correlation(request),
      });
    return sendSecurityProblem(reply, toSecurityProblem(error, correlation(request)));
  };

  /** The new account is signed in exactly like after a login. */
  const signedIn = async (
    request: FastifyRequest,
    reply: FastifyReply,
    result: { account: AccountRecord; issued: IssuedSession },
  ) => {
    const key = deps.deploymentKey();
    if (key === null)
      return sendSecurityProblem(reply, {
        code: "installation_degraded",
        correlationId: correlation(request),
      });
    const now = deps.now();
    await recordDeviceActivity(deps.db, { deviceId: result.issued.session.deviceId, now });
    setSessionCookie(
      reply,
      deps.config,
      result.issued.secret,
      Math.max(0, Math.floor((result.issued.session.expiresAt.getTime() - now.getTime()) / 1000)),
    );
    const session = result.issued.session;
    return reply.status(201).send({
      account: me(result.account),
      session: {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        authMethod: session.authMethod,
        issuedAt: session.issuedAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        state: session.state,
      },
      csrfToken: deriveCsrfToken(key, session.sessionId),
    });
  };

  const problems = {
    400: SecurityProblemSchema,
    401: SecurityProblemSchema,
    403: SecurityProblemSchema,
    404: SecurityProblemSchema,
    409: SecurityProblemSchema,
    410: SecurityProblemSchema,
    428: SecurityProblemSchema,
    429: SecurityProblemSchema,
    500: SecurityProblemSchema,
    503: SecurityProblemSchema,
  };

  // -------------------------------------------------------------------------
  // First launch and sign-up (anonymous)
  // -------------------------------------------------------------------------

  app.post(
    "/v1/bootstrap",
    {
      schema: {
        body: BootstrapAccountSchema,
        response: { 201: AccountSessionSchema, ...problems },
      },
    },
    async (request, reply) => {
      const body = request.body as BootstrapAccountDto;
      try {
        const result = await deps.accounts.bootstrap({
          email: body.email,
          pseudonym: body.pseudonym,
          password: body.password,
          device: body.device,
          correlationId: correlation(request),
        });
        return await signedIn(request, reply, result);
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    "/v1/auth/signup",
    { schema: { body: SignupSchema, response: { 201: AccountSessionSchema, ...problems } } },
    async (request, reply) => {
      const body = request.body as SignupDto;
      try {
        const result = await deps.accounts.signup({
          email: body.email,
          pseudonym: body.pseudonym,
          password: body.password,
          device: body.device,
          ...(body.invitation === undefined ? {} : { invitation: body.invitation }),
          correlationId: correlation(request),
        });
        return await signedIn(request, reply, result);
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // The signed-in account
  // -------------------------------------------------------------------------

  app.get(
    "/v1/me",
    { schema: { response: { 200: MeSchema, ...problems } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, {});
      if (owner === null) return reply;
      const accounts = await deps.accounts.list();
      const account = accounts.find((candidate) => candidate.id === owner.ownerId);
      if (account === undefined) return fail(request, reply, new AccountRefusedError("not_found"));
      return reply.status(200).send(me(account));
    },
  );

  app.patch(
    "/v1/me",
    { schema: { body: MeUpdateSchema, response: { 200: MeSchema, ...problems } } },
    async (request, reply) => {
      const body = request.body as MeUpdateDto;
      // Changing the sign-in identifier is sensitive; a pseudonym is not.
      const owner = deps.require(request, reply, {
        csrf: true,
        recentAuthentication: body.email !== undefined,
      });
      if (owner === null) return reply;
      try {
        const account = await deps.accounts.updateProfile({
          accountId: owner.ownerId,
          ...(body.email === undefined ? {} : { email: body.email }),
          ...(body.pseudonym === undefined ? {} : { pseudonym: body.pseudonym }),
          correlationId: correlation(request),
        });
        return reply.status(200).send(me(account));
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------------

  const requireAdministrator = (
    request: FastifyRequest,
    reply: FastifyReply,
    requirement: { csrf?: boolean; recentAuthentication?: boolean },
  ): OwnerPrincipal | null => {
    const owner = deps.require(request, reply, requirement);
    if (owner === null) return null;
    if (owner.role !== "administrator") {
      sendSecurityProblem(reply, { code: "not_found", correlationId: correlation(request) });
      return null;
    }
    return owner;
  };

  app.get(
    "/v1/admin/accounts",
    { schema: { response: { 200: AdminAccountListSchema, ...problems } } },
    async (request, reply) => {
      if (requireAdministrator(request, reply, {}) === null) return reply;
      const accounts = await deps.accounts.list();
      return reply.status(200).send({ accounts: accounts.map(adminView) });
    },
  );

  app.post(
    "/v1/admin/accounts",
    {
      schema: {
        body: AdminAccountCreateSchema,
        response: { 201: AdminAccountViewSchema, ...problems },
      },
    },
    async (request, reply) => {
      const admin = requireAdministrator(request, reply, {
        csrf: true,
        recentAuthentication: true,
      });
      if (admin === null) return reply;
      const body = request.body as AdminAccountCreateDto;
      try {
        const account = await deps.accounts.createByAdministrator({
          email: body.email,
          pseudonym: body.pseudonym,
          password: body.password,
          administratorId: admin.ownerId,
          correlationId: correlation(request),
        });
        return reply.status(201).send(adminView(account));
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  for (const [action, disabled] of [
    ["disable", true],
    ["enable", false],
  ] as const) {
    app.post(
      `/v1/admin/accounts/:accountId/${action}`,
      { schema: { params: AccountParams, response: { 204: Type.Null(), ...problems } } },
      async (request, reply) => {
        if (
          requireAdministrator(request, reply, { csrf: true, recentAuthentication: true }) === null
        )
          return reply;
        const { accountId } = request.params as { accountId: string };
        try {
          await deps.accounts.setDisabled({
            accountId,
            disabled,
            correlationId: correlation(request),
          });
          return reply.status(204).send();
        } catch (error) {
          return fail(request, reply, error);
        }
      },
    );
  }

  app.post(
    "/v1/admin/accounts/:accountId/password",
    {
      schema: {
        params: AccountParams,
        body: AdminPasswordResetSchema,
        response: { 204: Type.Null(), ...problems },
      },
    },
    async (request, reply) => {
      if (requireAdministrator(request, reply, { csrf: true, recentAuthentication: true }) === null)
        return reply;
      const { accountId } = request.params as { accountId: string };
      const body = request.body as AdminPasswordResetDto;
      try {
        await deps.accounts.resetPassword({
          accountId,
          password: body.password,
          correlationId: correlation(request),
        });
        return reply.status(204).send();
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.delete(
    "/v1/admin/accounts/:accountId",
    {
      schema: {
        params: AccountParams,
        body: AdminAccountDeleteSchema,
        response: { 204: Type.Null(), ...problems },
      },
    },
    async (request, reply) => {
      if (requireAdministrator(request, reply, { csrf: true, recentAuthentication: true }) === null)
        return reply;
      const { accountId } = request.params as { accountId: string };
      const body = request.body as AdminAccountDeleteDto;
      try {
        await deps.accounts.delete({
          accountId,
          confirmEmail: body.confirmEmail,
          correlationId: correlation(request),
        });
        return reply.status(204).send();
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.get(
    "/v1/admin/registration",
    { schema: { response: { 200: RegistrationSettingsSchema, ...problems } } },
    async (request, reply) => {
      if (requireAdministrator(request, reply, {}) === null) return reply;
      const installation = await findInstallation(deps.db);
      return reply.status(200).send({ mode: installation?.registrationMode ?? "closed" });
    },
  );

  app.put(
    "/v1/admin/registration",
    {
      schema: {
        body: RegistrationSettingsSchema,
        response: { 200: RegistrationSettingsSchema, ...problems },
      },
    },
    async (request, reply) => {
      if (requireAdministrator(request, reply, { csrf: true, recentAuthentication: true }) === null)
        return reply;
      const body = request.body as RegistrationSettingsDto;
      await deps.accounts.setRegistrationMode(body.mode, correlation(request));
      return reply.status(200).send({ mode: body.mode });
    },
  );

  const invitationView = (
    invitation: Awaited<ReturnType<AccountService["listInvitations"]>>[number],
  ) => ({
    invitationId: invitation.id,
    label: invitation.label,
    maxUses: invitation.maxUses,
    useCount: invitation.useCount,
    expiresAt: invitation.expiresAt?.toISOString() ?? null,
    state: invitation.state,
    createdAt: invitation.createdAt.toISOString(),
    accounts: invitation.accounts.map((account) => ({
      accountId: account.id,
      email: account.email,
      pseudonym: account.pseudonym,
      createdAt: account.createdAt.toISOString(),
    })),
  });

  app.get(
    "/v1/admin/invitations",
    { schema: { response: { 200: InvitationListSchema, ...problems } } },
    async (request, reply) => {
      if (requireAdministrator(request, reply, {}) === null) return reply;
      const invitations = await deps.accounts.listInvitations();
      return reply.status(200).send({ invitations: invitations.map(invitationView) });
    },
  );

  app.post(
    "/v1/admin/invitations",
    {
      schema: {
        body: InvitationCreateSchema,
        response: { 201: InvitationCreatedSchema, ...problems },
      },
    },
    async (request, reply) => {
      const admin = requireAdministrator(request, reply, {
        csrf: true,
        recentAuthentication: true,
      });
      if (admin === null) return reply;
      const body = request.body as InvitationCreateDto;
      const created = await deps.accounts.createInvitation({
        administratorId: admin.ownerId,
        ...(body.label === undefined ? {} : { label: body.label }),
        ...(body.maxUses === undefined ? {} : { maxUses: body.maxUses }),
        ...(body.expiresInDays === undefined ? {} : { expiresInDays: body.expiresInDays }),
        correlationId: correlation(request),
      });
      const listed = (await deps.accounts.listInvitations()).find(
        (invitation) => invitation.id === created.invitation.id,
      );
      if (listed === undefined) return fail(request, reply, new AccountRefusedError("not_found"));
      reply.header("cache-control", "no-store");
      return reply.status(201).send({
        invitation: invitationView(listed),
        // In the fragment: browsers never send it to a server, so it stays out
        // of request lines and access logs on the way back in.
        url: `${deps.publicOrigin}/join#${created.secret}`,
      });
    },
  );

  app.delete(
    "/v1/admin/invitations/:invitationId",
    { schema: { params: InvitationParams, response: { 204: Type.Null(), ...problems } } },
    async (request, reply) => {
      if (requireAdministrator(request, reply, { csrf: true }) === null) return reply;
      const { invitationId } = request.params as { invitationId: string };
      await deps.accounts.revokeInvitation(invitationId, correlation(request));
      return reply.status(204).send();
    },
  );
}
