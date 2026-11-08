import test from "node:test";
import assert from "node:assert/strict";
import { usd, priceLabel } from "../src/lib/format";

test("prices preserve billable microdollars rather than rounding to cents", () => {
  for (const [amount, label] of [
    [0, "Free"],
    [0.01, "$0.01"],
    [0.02, "$0.02"],
    [0.012345, "$0.012345"],
    [0.000001, "$0.000001"],
    [1.234567, "$1.234567"],
  ] as const)
    assert.equal(usd(amount), label);
  assert.equal(
    priceLabel({ model: "per_call", priceUsd: 0.012345, unit: "call" }),
    "$0.012345 / call",
  );
});
