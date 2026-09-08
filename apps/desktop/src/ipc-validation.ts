import { IPC_CHANNELS, type IpcChannel } from "./ipc-contract.ts";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 2048): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0")
  );
}
function only(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
export function isWrappedKeyEnvelope(value: unknown): boolean {
  return (
    record(value) &&
    only(value, ["keyId", "algorithm", "ciphertext", "createdAt", "revokedAt"]) &&
    text(value["keyId"], 128) &&
    value["algorithm"] === "os-protected-envelope-v1" &&
    text(value["ciphertext"], 8192) &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value["ciphertext"]) &&
    text(value["createdAt"], 64) &&
    Number.isFinite(Date.parse(value["createdAt"])) &&
    value["revokedAt"] === null
  );
}
export function validIpcPayload(channel: IpcChannel, value: unknown): boolean {
  switch (channel) {
    case IPC_CHANNELS.updateContext:
      return (
        record(value) &&
        only(value, ["pendingLocalChanges"]) &&
        typeof value["pendingLocalChanges"] === "boolean"
      );
    case IPC_CHANNELS.setActiveProfile:
      return (
        record(value) &&
        only(value, ["serverUrl", "label"]) &&
        text(value["serverUrl"]) &&
        (value["label"] === undefined || text(value["label"], 120))
      );
    case IPC_CHANNELS.wrapDeviceKey:
      return value instanceof Uint8Array && value.length === 32;
    case IPC_CHANNELS.unwrapDeviceKey:
      return isWrappedKeyEnvelope(value);
    case IPC_CHANNELS.openExternal:
      return record(value) && only(value, ["url"]) && text(value["url"]);
    case IPC_CHANNELS.chooseFile:
      return (
        record(value) &&
        only(value, ["title", "filters"]) &&
        (value["title"] === undefined || text(value["title"], 120)) &&
        (value["filters"] === undefined ||
          (Array.isArray(value["filters"]) &&
            value["filters"].length <= 20 &&
            value["filters"].every(
              (filter: unknown) =>
                record(filter) &&
                only(filter, ["name", "extensions"]) &&
                text(filter["name"], 80) &&
                Array.isArray(filter["extensions"]) &&
                filter["extensions"].length <= 20 &&
                filter["extensions"].every(
                  (extension: unknown) =>
                    text(extension, 20) && /^(\*|[a-zA-Z0-9]+)$/.test(extension),
                ),
            )))
      );
    case IPC_CHANNELS.saveFile:
      return (
        record(value) &&
        only(value, ["defaultName", "bytes"]) &&
        text(value["defaultName"], 200) &&
        !/[\\/:]/.test(value["defaultName"]) &&
        value["defaultName"] !== "." &&
        value["defaultName"] !== ".." &&
        value["bytes"] instanceof Uint8Array &&
        value["bytes"].byteLength <= MAX_FILE_BYTES
      );
    default:
      return value === undefined;
  }
}

export { MAX_FILE_BYTES };
