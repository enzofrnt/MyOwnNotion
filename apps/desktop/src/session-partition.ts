import { partitionName } from "./vault-profile.ts";

export function sessionPartitionForProfile(profileId: string | null): string {
  if (profileId === null || profileId.length === 0) {
    return "persist:onboarding";
  }
  return partitionName(profileId);
}
