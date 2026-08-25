/**
 * Authorized device routes (T069, US3, FR-008 – FR-010, FR-023).
 *
 * The device inventory is the screen an owner opens when they think someone
 * else has access. Everything here is shaped by that moment:
 *
 *   - **revocation and reauthorization require recent authentication**, like
 *     "sign out everywhere else". They are precisely the controls an attacker
 *     holding a stolen session would reach for, and requiring a fresh proof
 *     costs the owner one prompt while costing the attacker the whole attack;
 *   - **a device that is not yours is "not found"**, never "forbidden". The
 *     difference tells a caller whether an id exists, which turns the endpoint
 *     into a device enumerator;
 *   - **renaming needs CSRF but not recency.** Requiring a passkey prompt to
 *     fix a typo trains owners to approve prompts, which is the habit the
 *     recency requirement on revocation depends on.
 */

import {
  DeviceSchema,
  type DeviceUpdateDto,
  DeviceUpdateSchema,
  SecurityProblemSchema,
} from "@myownnotion/contracts";
import { DeviceRepositoryError } from "@myownnotion/database";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendSecurityProblem } from "../plugins/errors.ts";
import type { AuditService } from "../security/audit-service.ts";
import type { DeviceService } from "../security/device-service.ts";
import { type RequestPrincipal, requestContext } from "../security/request-context.ts";

export interface DeviceRouteDeps {
  readonly devices: DeviceService;
  readonly audit: AuditService;
  readonly installationId: string;
  readonly onDeviceRevoked?: (input: { ownerId: string; deviceId: string }) => void;
  /**
   * The shared authentication gate from the authentication routes.
   *
   * Passed in rather than rebuilt so a device route cannot end up with a
   * subtly different idea of what "recent" or "valid CSRF" means.
   */
  readonly require: (
    request: FastifyRequest,
    reply: FastifyReply,
    requirement: { csrf?: boolean; recentAuthentication?: boolean },
  ) => OwnerPrincipal | null;
}

/** The narrowed principal every handler here works from. */
type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;

const DeviceParams = Type.Object({ deviceId: Type.String({ format: "uuid" }) });
const DeviceListSchema = Type.Object(
  { devices: Type.Array(DeviceSchema) },
  { additionalProperties: false },
);

export function registerDeviceRoutes(app: FastifyInstance, deps: DeviceRouteDeps): void {
  const auditContext = (request: FastifyRequest) => ({
    installationId: deps.installationId,
    correlationId: requestContext(request).correlationId,
    actorClass: "owner" as const,
  });

  /**
   * Turns a repository refusal into a problem document.
   *
   * `device_not_found` covers both "no such id" and "belongs to someone else",
   * deliberately: distinguishing them would let a caller enumerate device ids.
   */
  const refuse = (request: FastifyRequest, reply: FastifyReply, error: unknown): FastifyReply => {
    const correlationId = requestContext(request).correlationId;
    if (error instanceof DeviceRepositoryError) {
      if (error.code === "device_not_found") {
        return sendSecurityProblem(reply, { code: "not_found", correlationId });
      }
      return sendSecurityProblem(reply, { code: "validation_failed", correlationId });
    }
    throw error;
  };

  app.get(
    "/v1/devices",
    { schema: { response: { 200: DeviceListSchema, 401: SecurityProblemSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, {});
      if (owner === null) {
        return reply;
      }
      return reply.status(200).send({ devices: await deps.devices.inventory(owner.ownerId) });
    },
  );

  app.get(
    "/v1/devices/:deviceId",
    { schema: { params: DeviceParams, response: { 200: DeviceSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, {});
      if (owner === null) {
        return reply;
      }
      const { deviceId } = request.params as { deviceId: string };
      const device = await deps.devices.inspect({ ownerId: owner.ownerId, deviceId });
      if (device === null) {
        return sendSecurityProblem(reply, {
          code: "not_found",
          correlationId: requestContext(request).correlationId,
        });
      }
      return reply.status(200).send(device);
    },
  );

  app.patch(
    "/v1/devices/:deviceId",
    { schema: { params: DeviceParams, body: DeviceUpdateSchema, response: { 200: DeviceSchema } } },
    async (request, reply) => {
      // CSRF but not recency: making an owner re-authenticate to fix a typo in
      // a device name trains them to approve prompts without reading them.
      const owner = deps.require(request, reply, { csrf: true });
      if (owner === null) {
        return reply;
      }
      const { deviceId } = request.params as { deviceId: string };
      const body = request.body as DeviceUpdateDto;
      try {
        const device = await deps.devices.update({
          ownerId: owner.ownerId,
          deviceId,
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.localStorageLimitBytes === undefined
            ? {}
            : { localStorageLimitBytes: body.localStorageLimitBytes }),
        });
        await deps.audit.record(auditContext(request), {
          eventType: "device.renamed",
          outcome: "success",
          objectKind: "device",
          objectId: deviceId,
        });
        return reply.status(200).send(device);
      } catch (error) {
        return refuse(request, reply, error);
      }
    },
  );

  app.post(
    "/v1/devices/:deviceId/revoke",
    { schema: { params: DeviceParams, response: { 200: DeviceSchema } } },
    async (request, reply) => {
      // Recent authentication, like "sign out everywhere else": this is the
      // control an attacker holding a stolen session would use, and it is the
      // one an owner uses when they already suspect one.
      const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const { deviceId } = request.params as { deviceId: string };
      try {
        const device = await deps.devices.revoke({ ownerId: owner.ownerId, deviceId });
        deps.onDeviceRevoked?.({ ownerId: owner.ownerId, deviceId });
        await deps.audit.record(auditContext(request), {
          eventType: "device.revoked",
          outcome: "success",
          objectKind: "device",
          objectId: deviceId,
        });
        return reply.status(200).send(device);
      } catch (error) {
        return refuse(request, reply, error);
      }
    },
  );

  app.post(
    "/v1/devices/:deviceId/reauthorize",
    { schema: { params: DeviceParams, response: { 200: DeviceSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const { deviceId } = request.params as { deviceId: string };
      try {
        const device = await deps.devices.requireReauthorization({
          ownerId: owner.ownerId,
          deviceId,
        });
        await deps.audit.record(auditContext(request), {
          eventType: "device.reauthorization-required",
          outcome: "success",
          objectKind: "device",
          objectId: deviceId,
        });
        return reply.status(200).send(device);
      } catch (error) {
        return refuse(request, reply, error);
      }
    },
  );
}
