# SPRINT WORK. Aggregates sprint/results/rows_*.csv into tables and figures.
import csv, json, math, collections, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

def load(tag):
    with open(f"sprint/results/rows_{tag}.csv") as f:
        return list(csv.DictReader(f))

def wilson(k, n, z=1.96):
    if n == 0: return (0, 0)
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n)) / d; w = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return (max(0, c-w), min(1, c+w))

rows = load("synthetic")
configs = list(dict.fromkeys(r["config"] for r in rows))
ops = list(dict.fromkeys(r["op"] for r in rows))
cls_tmp = {r["op"]: r["cls"] for r in rows}
ops = sorted(ops, key=lambda o: cls_tmp[o])
cls_of = {r["op"]: r["cls"] for r in rows}
harm_of = {r["op"]: r["harmful"] == "true" for r in rows}
agg = collections.defaultdict(lambda: [0, 0])
for r in rows:
    a = agg[(r["op"], r["config"])]; a[1] += 1; a[0] += r["pass"] == "false"
out = {"configs": configs, "per_op": {}, "per_class": {}, "overall": {}}
for o in ops:
    out["per_op"][o] = {c: {"flagged": agg[(o, c)][0], "n": agg[(o, c)][1]} for c in configs}
classes = list(dict.fromkeys(cls_of[o] for o in ops))
for cl in classes:
    out["per_class"][cl] = {}
    for c in configs:
        k = sum(agg[(o, c)][0] for o in ops if cls_of[o] == cl); n = sum(agg[(o, c)][1] for o in ops if cls_of[o] == cl)
        out["per_class"][cl][c] = {"flagged": k, "n": n, "rate": k/n if n else None, "ci95": wilson(k, n)}
# overall: harmful excluding fuzz and pre-anchor (in-scope adversaries) -> detection; benign -> false positive
for c in configs:
    hk = sum(agg[(o, c)][0] for o in ops if harm_of[o] and not cls_of[o].startswith(("Z", "P")))
    hn = sum(agg[(o, c)][1] for o in ops if harm_of[o] and not cls_of[o].startswith(("Z", "P")))
    bk = sum(agg[(o, c)][0] for o in ops if not harm_of[o]); bn = sum(agg[(o, c)][1] for o in ops if not harm_of[o])
    # operator-level: share of in-scope harmful operators detected on >=99% of their mutants
    inscope = [o for o in ops if harm_of[o] and not cls_of[o].startswith(("Z", "P"))]
    full = sum(1 for o in inscope if agg[(o, c)][0] >= 0.99 * agg[(o, c)][1])
    out["overall"][c] = {"harmful_detected": hk, "harmful_n": hn, "detection": hk/hn, "detection_ci95": wilson(hk, hn),
                         "benign_flagged": bk, "benign_n": bn, "fpr": bk/bn, "fpr_ci95": wilson(bk, bn), "ops_fully_detected": full, "ops_inscope": len(inscope)}
json.dump(out, open("sprint/results/aggregate_synthetic.json", "w"), indent=1)
for c in configs:
    o = out["overall"][c]
    print(f"{c:42s} detect {o['harmful_detected']}/{o['harmful_n']} = {100*o['detection']:.1f}% [{100*o['detection_ci95'][0]:.1f},{100*o['detection_ci95'][1]:.1f}]  FP {o['benign_flagged']}/{o['benign_n']}  ops fully caught {o['ops_fully_detected']}/{o['ops_inscope']}")

# ---- Figure 1: heatmap ----
short = {"C1 hash chain": "C1\nchain", "C2 +replay & rules": "C2\n+replay", "C3 shipped (offline)": "C3\nshipped", "C3h C3 + summary binding + strict": "C3h\nC3+bind", "C4 shipped + anchor (receipt-directed)": "C4\nC3+anchor", "C5 C4 + summary binding + strict": "C5\nC4+bind", "C6 C5 + pinned anchor lookup": "C6\nC5+pinned"}
M = np.array([[out["per_op"][o][c]["flagged"]/max(1, out["per_op"][o][c]["n"]) for c in configs] for o in ops])
fig, ax = plt.subplots(figsize=(8.4, 6.6))
cmap = matplotlib.colors.LinearSegmentedColormap.from_list("bb", ["#f6efe2", "#c7d9b0", "#2f6b3a"])
ax.imshow(M, aspect="auto", cmap=cmap, vmin=0, vmax=1)
for i, o in enumerate(ops):
    for j, c in enumerate(configs):
        v = M[i, j]; ben = not harm_of[o]
        txt = f"{100*v:.0f}"
        col = "white" if v > 0.6 else "black"
        if (ben and v > 0) or (not ben and v < 0.99 and not cls_of[o].startswith(("Z", "P"))): col = "#a3001b" if v < 0.6 else "white"
        ax.text(j, i, txt, ha="center", va="center", fontsize=7, color=col, fontweight="bold" if col == "#a3001b" else "normal")
labels = [f"{o}  (n={out['per_op'][o][configs[0]]['n']})" for o in ops]
ax.set_yticks(range(len(ops))); ax.set_yticklabels(labels, fontsize=7.5, family="monospace")
ax.set_xticks(range(len(configs))); ax.set_xticklabels([short[c] for c in configs], fontsize=8)
ax.xaxis.tick_top()
prev = None
for i, o in enumerate(ops):
    if prev is not None and cls_of[o] != prev: ax.axhline(i - 0.5, color="#333", lw=0.8)
    prev = cls_of[o]
for i, o in enumerate(ops):
    if i == 0 or cls_of[ops[i-1]] != cls_of[o]:
        ax.text(len(configs) - 0.35, i - 0.35, cls_of[o], fontsize=6.5, ha="left", va="top", color="#444", clip_on=False)
plt.tight_layout()
plt.savefig("sprint/results/fig1_heatmap.png", dpi=200, bbox_inches="tight")

# ---- Figure 2: per-class detection under shipped vs hardened ----
inscope = [cl for cl in classes if not cl.startswith(("A0", "Z", "P"))]
sel = ["C3 shipped (offline)", "C4 shipped + anchor (receipt-directed)", "C5 C4 + summary binding + strict", "C6 C5 + pinned anchor lookup"]
cols = ["#d9c7a7", "#9db58a", "#5f8f5a", "#2f4f33"]
fig, ax = plt.subplots(figsize=(7.2, 2.9))
w = 0.2
for k, c in enumerate(sel):
    vals = [out["per_class"][cl][c]["rate"] for cl in inscope]
    los = [max(0.0, vals[i] - out["per_class"][cl][c]["ci95"][0]) for i, cl in enumerate(inscope)]
    his = [max(0.0, out["per_class"][cl][c]["ci95"][1] - vals[i]) for i, cl in enumerate(inscope)]
    ax.bar(np.arange(len(inscope)) + (k - 1.5) * w, [100*v for v in vals], w, yerr=[[100*x for x in los], [100*x for x in his]], capsize=1.5, color=cols[k], label=c, error_kw={"lw": 0.6})
ax.set_xticks(range(len(inscope))); ax.set_xticklabels(inscope, fontsize=7.5)
ax.set_ylabel("% harmful mutants flagged", fontsize=8); ax.set_ylim(0, 105); ax.tick_params(axis="y", labelsize=7)
ax.legend(fontsize=6.5, ncol=2, loc="lower left", frameon=False, bbox_to_anchor=(0, 1.0))
ax.spines[["top", "right"]].set_visible(False)
plt.tight_layout(); plt.savefig("sprint/results/fig2_classes.png", dpi=200, bbox_inches="tight")
print("figures written")
