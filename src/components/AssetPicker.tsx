"use client";

export type PickerAsset = {
  id: string;
  asset_type: string;
  symbol: string | null;
  name: string;
  quantity: string | number;
  available_quantity: string | number;
  unit: string | null;
  verified_ownership: boolean;
  chain?: string | null;
};

const qty = (v: unknown) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });

export function AssetPicker({
  assets,
  value,
  onChange,
}: {
  assets: PickerAsset[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (assets.length === 0) {
    return <p className="asset-picker-empty">Add an asset to your portfolio first, then choose it here to list on the marketplace.</p>;
  }

  return (
    <div className="asset-picker" role="radiogroup" aria-label="Choose the asset to list">
      {assets.map((a) => {
        const available = Number(a.available_quantity);
        const disabled = !Number.isFinite(available) || available <= 0;
        const selected = value === a.id;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            className={"asset-pick" + (selected ? " is-selected" : "") + (disabled ? " is-disabled" : "")}
            onClick={() => { if (!disabled) onChange(a.id); }}
          >
            <span className="asset-pick-main">
              <b>{a.name}{a.symbol ? " · " + a.symbol : ""}</b>
              <small>{a.asset_type}{a.chain ? " · " + a.chain : ""} · {a.verified_ownership ? "verified" : "unverified"}</small>
            </span>
            <span className="asset-pick-qty">
              <b>{qty(a.quantity)} {a.unit || ""}</b>
              <small>{disabled ? "None available" : qty(available) + " available"}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
