/** The immutable build identity compared by the pre-migration update guard. */

export const APPLICATION_VERSION =
  process.env["MYOWNNOTION_APPLICATION_VERSION"]?.trim() || "0.1.0";
