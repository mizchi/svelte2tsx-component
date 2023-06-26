export {};

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test("test", () => {
    expect(1 + 1).toBe(2);
  });
}
