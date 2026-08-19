import {
  ProblemSchema,
  type SearchRequestDto,
  SearchRequestSchema,
  SearchResponseSchema,
  SearchUnavailableProblemSchema,
} from "@myownnotion/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  SearchRequestError,
  type SearchService,
  SearchUnavailableError,
} from "../search/search-service.ts";
import { requestContext } from "../security/request-context.ts";

interface SearchRouteDeps {
  readonly service: SearchService;
}

function sendProblem(
  reply: FastifyReply,
  problem: {
    readonly status: 400 | 401 | 409 | 503;
    readonly code: string;
    readonly title: string;
    readonly searchState?: "building" | "degraded";
    readonly indexedCount?: number;
    readonly expectedCount?: number;
  },
): FastifyReply {
  return reply.status(problem.status).send({
    type: "about:blank",
    title: problem.title,
    status: problem.status,
    code: problem.code,
    ...(problem.searchState === undefined ? {} : { searchState: problem.searchState }),
    ...(problem.indexedCount === undefined ? {} : { indexedCount: problem.indexedCount }),
    ...(problem.expectedCount === undefined ? {} : { expectedCount: problem.expectedCount }),
  });
}

export function registerSearchRoutes(app: FastifyInstance, deps: SearchRouteDeps): void {
  app.post(
    "/v1/search",
    {
      schema: {
        body: SearchRequestSchema,
        response: {
          200: SearchResponseSchema,
          400: ProblemSchema,
          401: ProblemSchema,
          409: ProblemSchema,
          503: SearchUnavailableProblemSchema,
        },
      },
    },
    async (request, reply) => {
      if (requestContext(request).principal.kind !== "owner") {
        return sendProblem(reply, {
          status: 401,
          code: "authentication_required",
          title: "Authentication required",
        });
      }

      try {
        return reply.status(200).send(await deps.service.search(request.body as SearchRequestDto));
      } catch (error) {
        if (error instanceof SearchUnavailableError) {
          reply.header("retry-after", "1");
          return sendProblem(reply, {
            status: 503,
            code: error.code,
            title: "Complete search is temporarily unavailable",
            searchState: error.state,
            indexedCount: error.indexedCount,
            expectedCount: error.expectedCount,
          });
        }
        if (error instanceof SearchRequestError) {
          return sendProblem(reply, {
            status: error.status,
            code: error.code,
            title: "Search request is invalid",
          });
        }
        throw error;
      }
    },
  );
}
