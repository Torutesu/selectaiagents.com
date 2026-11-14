import test from "node:test";
import assert from "node:assert/strict";
import { noRouteMessage } from "../src/lib/router";

test("a price cap that excludes every agent is named in the error", () => {
  assert.match(
    noRouteMessage([{ status: "not_configured" }, { status: "over_budget" }]),
    /maximum price per call/,
  );
});

test("other routing failures keep the generic message", () => {
  assert.equal(
    noRouteMessage([{ status: "unavailable" }, { status: "incompatible" }]),
    "No compatible, configured, healthy agent is available",
  );
});
