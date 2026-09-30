import assert from "node:assert/strict";
import test from "node:test";
import "../app/static/watch-layout.js";

test("desktop divider keeps at least 320px video and 300px chat plus grip", () => {
  for (const width of [761,900,1280,1920,2560]) {
    const {min,max} = globalThis.watchLayout.bounds(width);
    assert.ok(min <= max);
    assert.ok(width * min / 100 >= 320);
    assert.ok(width * (100-max) / 100 >= 310 - 0.001);
    assert.ok(min >= 42 && max <= 78);
  }
});
test("stacked phone layout has safe bounds even before the room is visible", () => {
  assert.deepEqual(globalThis.watchLayout.bounds(0),{min:42,max:78});
  assert.deepEqual(globalThis.watchLayout.bounds(390),{min:42,max:78});
});
