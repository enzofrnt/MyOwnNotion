import {
  buildLegacySyncFixture,
  LEGACY_SYNC_FIXTURE_VERSIONS,
  type LegacySyncFixture,
} from "../build-legacy-sync-fixtures.ts";

/** All supported historical profiles, materialised as real AES-GCM envelopes. */
export async function loadEncryptedLegacySyncFixtures(): Promise<readonly LegacySyncFixture[]> {
  return await Promise.all(LEGACY_SYNC_FIXTURE_VERSIONS.map(buildLegacySyncFixture));
}
