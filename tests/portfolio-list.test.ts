import { describe, expect, it } from "vitest";
import { capListQuantity, listableAssets, nextSelectedAssetId } from "@/lib/portfolio-list";

const A = (id: string, available: number) => ({ id, available_quantity: available });

describe("listableAssets", () => {
  it("keeps only assets with a positive available quantity", () => {
    const assets = [A("a", 2), A("b", 0), A("c", "1.5" as unknown as number), A("d", -1)];
    expect(listableAssets(assets).map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("nextSelectedAssetId", () => {
  it("auto-selects the only listable asset", () => {
    expect(nextSelectedAssetId([A("a", 0), A("b", 3)], "")).toBe("b");
  });

  it("prefers a just-added asset when it is listable", () => {
    expect(nextSelectedAssetId([A("a", 2), A("b", 4)], "a", "b")).toBe("b");
  });

  it("keeps the current selection among several listable assets", () => {
    expect(nextSelectedAssetId([A("a", 2), A("b", 4)], "a")).toBe("a");
  });

  it("clears the selection when the current asset is no longer listable and more than one remains", () => {
    expect(nextSelectedAssetId([A("a", 0), A("b", 2), A("c", 3)], "a")).toBe("");
  });

  it("returns empty when nothing can be listed", () => {
    expect(nextSelectedAssetId([A("a", 0)], "a")).toBe("");
  });
});

describe("capListQuantity", () => {
  it("caps a quantity that exceeds what is owned", () => {
    expect(capListQuantity("12", 4)).toBe("4");
  });

  it("leaves a valid quantity and mid-keystroke input alone", () => {
    expect(capListQuantity("2", 4)).toBe("2");
    expect(capListQuantity("", 4)).toBe("");
    expect(capListQuantity(".", 4)).toBe(".");
  });

  it("does not invent a quantity when nothing is available", () => {
    expect(capListQuantity("2", 0)).toBe("2");
  });
});
