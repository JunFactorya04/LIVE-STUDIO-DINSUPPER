import { afterEach } from "vitest";

// jest-dom matchers and DOM cleanup only apply to tests that opt into jsdom with
// `// @vitest-environment jsdom`; logic tests run in plain node.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  await import("@testing-library/jest-dom/vitest");
  afterEach(() => cleanup());
}
