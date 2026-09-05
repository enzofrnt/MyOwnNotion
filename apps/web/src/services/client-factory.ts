import type { ClientRuntimeProfile } from "../runtime/client-runtime.ts";
import { ContentApi } from "./content-api.ts";
import { SecurityApi } from "./security-api.ts";

export function createContentApi(profile: ClientRuntimeProfile): ContentApi {
  return new ContentApi(profile.apiBaseUrl);
}

export function createSecurityApi(profile: ClientRuntimeProfile): SecurityApi {
  return new SecurityApi(profile.apiBaseUrl);
}

export function createClientApis(profile: ClientRuntimeProfile): {
  readonly content: ContentApi;
  readonly security: SecurityApi;
} {
  return {
    content: createContentApi(profile),
    security: createSecurityApi(profile),
  };
}
