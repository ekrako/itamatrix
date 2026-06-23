import type { FlatResult } from "./normalize.js";

export function renderJson(result: FlatResult): string {
  return JSON.stringify(result, null, 2);
}
