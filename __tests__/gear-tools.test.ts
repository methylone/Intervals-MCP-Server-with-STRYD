// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { intervalsClient } from "../src/core/intervals-client.js";
import { listGearTool } from "../src/core/tools/list-gear.js";
import { assignGearTool } from "../src/core/tools/assign-gear.js";
import { createGearTool } from "../src/core/tools/create-gear.js";
import { retireGearTool } from "../src/core/tools/retire-gear.js";

type Call = { path: string; method: string; body?: unknown };
type RouteResult = { status?: number; body?: unknown };

/**
 * Stub global fetch with a router keyed on (method, path). Lets the handler
 * tests drive the full handler → intervalsClient → fetch path (no module mock,
 * one client instance) while controlling per-activity GET/PUT outcomes. A
 * non-2xx status makes the client throw IntervalsApiError, exercising the
 * envelope's error bucket.
 */
function routedFetch(router: (c: Call) => RouteResult): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      const call: Call = {
        path: u.pathname,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const res = router(call);
      return Promise.resolve(
        new Response(res.body === undefined ? "" : JSON.stringify(res.body), {
          status: res.status ?? 200,
        }),
      );
    }),
  );
  return { calls };
}

const puts = (calls: Call[]) => calls.filter((c) => c.method === "PUT");

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── intervals-client gear methods ─────────────────────────────────────────────
describe("intervalsClient.getGear", () => {
  it("GETs /athlete/{id}/gear and returns the array verbatim", async () => {
    const gear = [{ id: "60751", name: "HOKA Clifton 10 Green", distance: 716680 }];
    const { calls } = routedFetch(() => ({ body: gear }));

    const result = await intervalsClient.getGear();

    expect(result).toEqual(gear);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/v1/athlete/i12345678/gear");
  });
});

describe("intervalsClient.assignActivityGear", () => {
  it("PUTs /activity/{id} with the nested {gear:{id}} body (not gear_id)", async () => {
    const { calls } = routedFetch(() => ({ body: { id: "i999" } }));

    await intervalsClient.assignActivityGear("i999", "60751");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].path).toBe("/api/v1/activity/i999");
    // Regression guard: the cookie API rejects {gear_id} (422); the v1 shape is {gear:{id}}.
    expect(calls[0].body).toEqual({ gear: { id: "60751" } });
  });
});

// ── list_gear handler ─────────────────────────────────────────────────────────
describe("list_gear handler", () => {
  it("returns the client gear list as a passthrough (retired included)", async () => {
    const gear = [{ id: "60751" }, { id: "60764", retired: true }];
    routedFetch(() => ({ body: gear }));

    const out = await listGearTool.handler({});

    expect(out).toEqual(gear);
  });
});

// ── assign_gear handler envelope ──────────────────────────────────────────────
describe("assign_gear handler envelope", () => {
  it("all success: assigns each activity not already on the gear", async () => {
    // GET returns unassigned; PUT succeeds.
    const { calls } = routedFetch((c) =>
      c.method === "GET" ? { body: { gear: null } } : { body: {} },
    );

    const out = (await assignGearTool.handler({
      activity_ids: ["i1", "i2"],
      gear_id: "60751",
    })) as { assigned: string[]; skipped: unknown[]; errors: unknown[] };

    expect(out.assigned).toEqual(["i1", "i2"]);
    expect(out.skipped).toEqual([]);
    expect(out.errors).toEqual([]);
    expect(puts(calls).map((c) => c.path)).toEqual([
      "/api/v1/activity/i1",
      "/api/v1/activity/i2",
    ]);
    expect(puts(calls)[0].body).toEqual({ gear: { id: "60751" } });
  });

  it("skip guard: an activity already on the target gear is skipped (no write)", async () => {
    const { calls } = routedFetch((c) => {
      if (c.method === "GET") {
        const id = c.path.split("/").pop();
        return { body: { gear: { id: id === "i1" ? "60751" : "60752" } } };
      }
      return { body: {} };
    });

    const out = (await assignGearTool.handler({
      activity_ids: ["i1", "i2"],
      gear_id: "60751",
    })) as { assigned: string[]; skipped: { activity_id: string }[]; errors: unknown[] };

    expect(out.skipped.map((s) => s.activity_id)).toEqual(["i1"]);
    expect(out.assigned).toEqual(["i2"]);
    expect(puts(calls).map((c) => c.path)).toEqual(["/api/v1/activity/i2"]);
  });

  it("partial failure: a failed PUT lands in errors, the rest still assign", async () => {
    const { calls } = routedFetch((c) => {
      if (c.method === "GET") return { body: { gear: null } };
      return c.path.endsWith("/i2") ? { status: 500, body: { error: "boom" } } : { body: {} };
    });

    const out = (await assignGearTool.handler({
      activity_ids: ["i1", "i2", "i3"],
      gear_id: "60751",
    })) as { assigned: string[]; errors: { activity_id: string; error: string }[] };

    expect(out.assigned).toEqual(["i1", "i3"]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].activity_id).toBe("i2");
    expect(puts(calls)).toHaveLength(3);
  });

  it("all failure: errors populated, assigned empty, never throws", async () => {
    routedFetch((c) => (c.method === "GET" ? { body: { gear: null } } : { status: 500, body: {} }));

    const out = (await assignGearTool.handler({
      activity_ids: ["i1", "i2"],
      gear_id: "60751",
    })) as { assigned: string[]; errors: unknown[] };

    expect(out.assigned).toEqual([]);
    expect(out.errors).toHaveLength(2);
  });

  it("a GET (skip-guard) failure is captured as an error, not thrown, and no PUT fires", async () => {
    const { calls } = routedFetch((c) =>
      c.method === "GET" ? { status: 500, body: {} } : { body: {} },
    );

    const out = (await assignGearTool.handler({
      activity_ids: ["i1"],
      gear_id: "60751",
    })) as { errors: { activity_id: string }[] };

    expect(out.errors[0].activity_id).toBe("i1");
    expect(puts(calls)).toHaveLength(0);
  });
});

// ── create_gear / retire_gear client methods ──────────────────────────────────
describe("intervalsClient.createGear", () => {
  it("POSTs /athlete/{id}/gear with the {name,type,purchased} body", async () => {
    const { calls } = routedFetch(() => ({ body: { id: "60805" } }));

    const out = await intervalsClient.createGear({ name: "Test Shoe", type: "Shoes", purchased: "2026-06-07" });

    expect(out).toEqual({ id: "60805" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/athlete/i12345678/gear");
    expect(calls[0].body).toEqual({ name: "Test Shoe", type: "Shoes", purchased: "2026-06-07" });
  });
});

describe("intervalsClient.updateGear", () => {
  it("PUTs /athlete/{id}/gear/{gearId} with the {retired} body", async () => {
    const { calls } = routedFetch(() => ({ body: { id: "60805", retired: "2026-06-07" } }));

    await intervalsClient.updateGear("60805", { retired: "2026-06-07T00:00:00" });

    expect(calls[0].method).toBe("PUT");
    expect(calls[0].path).toBe("/api/v1/athlete/i12345678/gear/60805");
    expect(calls[0].body).toEqual({ retired: "2026-06-07T00:00:00" });
  });
});

// ── create_gear handler ───────────────────────────────────────────────────────
describe("create_gear handler", () => {
  it("returns the created gear raw; sends only provided fields", async () => {
    const { calls } = routedFetch(() => ({ body: { id: "60805", name: "New Shoe" } }));

    const out = await createGearTool.handler({ name: "New Shoe", type: "Shoes" });

    expect(out).toEqual({ id: "60805", name: "New Shoe" });
    expect(calls[0].body).toEqual({ name: "New Shoe", type: "Shoes" }); // no purchased/notes keys
  });

  it("hard failure throws (single write, no envelope)", async () => {
    routedFetch(() => ({ status: 500, body: { error: "boom" } }));
    await expect(createGearTool.handler({ name: "X", type: "Shoes" })).rejects.toThrow();
  });
});

describe("create_gear schema", () => {
  const schema = z.object(createGearTool.schema);

  it("rejects empty/whitespace name, accepts a normal name", () => {
    expect(schema.safeParse({ name: "" }).success).toBe(false);
    expect(schema.safeParse({ name: "   " }).success).toBe(false);
    expect(schema.safeParse({ name: "HOKA Clifton 10" }).success).toBe(true);
  });

  it("defaults type to Shoes and trims name", () => {
    const parsed = schema.parse({ name: "  Brooks Ghost 16  " });
    expect(parsed.type).toBe("Shoes");
    expect(parsed.name).toBe("Brooks Ghost 16");
  });

  it("rejects name >100 chars and a malformed purchased date", () => {
    expect(schema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ name: "ok", purchased: "2026/06/07" }).success).toBe(false);
  });
});

// ── retire_gear handler ───────────────────────────────────────────────────────
describe("retire_gear handler", () => {
  it("appends T00:00:00 to a provided date", async () => {
    const { calls } = routedFetch(() => ({ body: { id: "60751", retired: "2026-06-01" } }));

    await retireGearTool.handler({ gear_id: "60751", retired: "2026-06-01" });

    expect(calls[0].method).toBe("PUT");
    expect(calls[0].path).toBe("/api/v1/athlete/i12345678/gear/60751");
    expect(calls[0].body).toEqual({ retired: "2026-06-01T00:00:00" });
  });

  it("defaults to today (YYYY-MM-DDT00:00:00) when retired omitted", async () => {
    const { calls } = routedFetch(() => ({ body: {} }));

    await retireGearTool.handler({ gear_id: "60751" });

    expect((calls[0].body as { retired: string }).retired).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);
  });

  it("hard failure throws", async () => {
    routedFetch(() => ({ status: 500, body: {} }));
    await expect(retireGearTool.handler({ gear_id: "60751" })).rejects.toThrow();
  });
});

describe("retire_gear schema", () => {
  const schema = z.object(retireGearTool.schema);

  it("requires gear_id and validates the retired date format", () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ gear_id: "60751" }).success).toBe(true);
    expect(schema.safeParse({ gear_id: "60751", retired: "2026-06-07" }).success).toBe(true);
    expect(schema.safeParse({ gear_id: "60751", retired: "yesterday" }).success).toBe(false);
  });
});

// ── assign_gear schema validation ─────────────────────────────────────────────
describe("assign_gear schema", () => {
  const schema = z.object(assignGearTool.schema);

  it("accepts a valid 1-element call", () => {
    expect(schema.safeParse({ activity_ids: ["i123"], gear_id: "60751" }).success).toBe(true);
  });

  it("rejects an activity_id that is actually a name (non-ASCII / spaces)", () => {
    expect(schema.safeParse({ activity_ids: ["朝ジョグ"], gear_id: "60751" }).success).toBe(false);
    expect(schema.safeParse({ activity_ids: ["Easy Run"], gear_id: "60751" }).success).toBe(false);
  });

  it("rejects an empty activity_ids array and >30 elements", () => {
    expect(schema.safeParse({ activity_ids: [], gear_id: "60751" }).success).toBe(false);
    const tooMany = Array.from({ length: 31 }, (_, i) => `i${i}`);
    expect(schema.safeParse({ activity_ids: tooMany, gear_id: "60751" }).success).toBe(false);
  });

  it("accepts exactly 30 elements (upper bound)", () => {
    const exactly30 = Array.from({ length: 30 }, (_, i) => `i${i}`);
    expect(schema.safeParse({ activity_ids: exactly30, gear_id: "60751" }).success).toBe(true);
  });

  it("rejects a missing/empty gear_id", () => {
    expect(schema.safeParse({ activity_ids: ["i1"] }).success).toBe(false);
    expect(schema.safeParse({ activity_ids: ["i1"], gear_id: "" }).success).toBe(false);
  });
});
