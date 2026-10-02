import { expect, it, vi } from "vitest";
import { encodeBase64Url } from "../src/binary.ts";
import { isQuotaError } from "../src/local-store/storage-errors.ts";
import { classifyPageSyncBlockedReason } from "../src/page-sync/blocked-reason.ts";
import { decodePageOperationBytes } from "../src/page-sync/encrypted-update-log.ts";
import type { LocalRecordCodec } from "../src/security/local-record-codec.ts";
import { openStoredConflict } from "../src/security/open-stored-conflict.ts";

it("encodes browser buffers and views with the existing canonical decoder", () => {
  const bytes = new Uint8Array([0, 251, 255, 128]);
  expect(encodeBase64Url(bytes)).toBe("APv_gA");
  expect(encodeBase64Url(bytes.buffer)).toBe("APv_gA");
  expect(encodeBase64Url(bytes.subarray(1, 3))).toBe("-_8");
  expect([...decodePageOperationBytes(encodeBase64Url(bytes))]).toEqual([...bytes]);
  expect(encodeBase64Url(new Uint8Array())).toBe("");
});
it("preserves wrapped quota and protocol classification precedence", () => {
  for (const error of [
    { name: "QuotaExceededError" },
    { inner: { name: "QuotaExceededError" }, name: "SchemaProtocolError" },
  ]) {
    expect(isQuotaError(error)).toBe(true);
    expect(classifyPageSyncBlockedReason(error)).toBe("quota");
  }
  expect(classifyPageSyncBlockedReason({ name: "ProtocolValidationError" })).toBe("protocol");
  expect(classifyPageSyncBlockedReason({ name: "SchemaError" })).toBe("validation");
  for (const error of [null, "QuotaExceededError", new Error("quota")])
    expect(classifyPageSyncBlockedReason(error)).toBe("storage");
});
it("opens retained plaintext conflicts without crypto and fails closed for sealed rows", async () => {
  const plain = { payload: {} };
  expect(await openStoredConflict(plain)).toBe(plain);
  await expect(openStoredConflict({ envelope: {} })).rejects.toThrow("codec is required");
  const openConflict = vi.fn().mockResolvedValue(plain);
  const codec = { openConflict } as unknown as LocalRecordCodec;
  const sealed = { envelope: {} };
  expect(await openStoredConflict(sealed, codec)).toBe(plain);
  expect(openConflict).toHaveBeenCalledWith(sealed);
});
