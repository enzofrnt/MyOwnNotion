const PERFORMANCE_TEST_PATH = /(?:^|\/)tests\/performance\/[^/]+\.spec\.ts$/u;

export function usesVitestProject(arguments_: readonly string[], project: string): boolean {
  return arguments_.some(
    (argument, index) =>
      argument === `--project=${project}` ||
      (argument === "--project" && arguments_[index + 1] === project),
  );
}

function isPerformanceTestPath(argument: string): boolean {
  return PERFORMANCE_TEST_PATH.test(argument.replaceAll("\\", "/"));
}

/**
 * Performance references allocate deliberately large fixtures. A fresh Vitest
 * coordinator per file prevents one reference from retaining worker/RPC state
 * that can distort the next one, while the outer runner keeps PostgreSQL shared.
 */
export function planVitestInvocations(
  arguments_: readonly string[],
  discoveredPerformanceTests: readonly string[],
): string[][] {
  if (!usesVitestProject(arguments_, "performance") || arguments_[0] !== "run") {
    return [[...arguments_]];
  }

  const explicitPerformanceTests = arguments_.filter(isPerformanceTestPath);
  const selectedTests = [
    ...new Set(
      (explicitPerformanceTests.length > 0
        ? explicitPerformanceTests
        : discoveredPerformanceTests
      ).filter(isPerformanceTestPath),
    ),
  ].sort();

  if (selectedTests.length === 0) {
    throw new Error("No performance benchmark was discovered for the Vitest performance project");
  }

  const sharedArguments = arguments_.filter((argument) => !isPerformanceTestPath(argument));
  return selectedTests.map((testPath) => [...sharedArguments, testPath]);
}
