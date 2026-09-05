export interface VaultProfile {
  readonly vaultId: string;
  readonly profileId: string;
  readonly schemaVersion: number;
}

export function vaultDirectory(userData: string, profileId: string): string {
  return `${userData}/vaults/${profileId}`;
}

export function partitionName(profileId: string): string {
  return `persist:profile-${profileId}`;
}
