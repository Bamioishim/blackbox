export type ListableAsset = {
  id: string;
  available_quantity: string | number;
};

/** Assets with a positive remaining quantity that can be listed. */
export function listableAssets<T extends ListableAsset>(assets: T[]): T[] {
  return assets.filter((a) => Number(a.available_quantity) > 0);
}

/**
 * Pick which portfolio asset the listing form should have selected.
 * A just-added asset is preferred; a sole listable asset is auto-selected;
 * an existing valid selection is kept; otherwise the user must choose.
 */
export function nextSelectedAssetId(
  assets: ListableAsset[],
  currentId: string,
  preferId?: string,
): string {
  const listable = listableAssets(assets);
  if (preferId && listable.some((a) => a.id === preferId)) return preferId;
  if (listable.length === 1) return listable[0].id;
  if (currentId && listable.some((a) => a.id === currentId)) return currentId;
  return "";
}

/** Cap a listing quantity to the amount still available, without fighting mid-keystroke input. */
export function capListQuantity(qty: string, available: number): string {
  if (!Number.isFinite(available) || available <= 0) return qty;
  const trimmed = qty.trim();
  if (trimmed === "") return qty;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return qty;
  if (n > available) return String(available);
  return qty;
}
