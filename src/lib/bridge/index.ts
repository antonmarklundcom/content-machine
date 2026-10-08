/**
 * The query layer between the app's two halves — see ./README.md.
 *
 * Later phases import from `@/lib/bridge`, not from the files behind it, so
 * the surface they are allowed to use is the one this file re-exports.
 */
export * from "./brands";
export * from "./clips";
export * from "./analyses";
export * from "./marks";
export * from "./ideas";
// Build 3 (PLAN.md §2, O9): the social OS.
export * from "./families";
export * from "./accounts";
export * from "./assets";
export * from "./posts";
export * from "./metrics";
