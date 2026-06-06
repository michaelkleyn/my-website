#!/usr/bin/env python3
# Generate a Gaussian-splat .ply from a single image via the VAST-AI/TripoSplat
# HF Space (Gradio API). Handles upload, ZeroGPU auth, queue + polling, download.
#
# Usage: python triposplat_gen.py INPUT.png OUTPUT.ply [seed steps guidance num_gaussians]
import sys, os, shutil
from gradio_client import Client, handle_file

inp, out = sys.argv[1], sys.argv[2]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 42
steps = int(sys.argv[4]) if len(sys.argv) > 4 else 20
guidance = float(sys.argv[5]) if len(sys.argv) > 5 else 3.0
ngauss = int(sys.argv[6]) if len(sys.argv) > 6 else 262144

token = os.environ.get("HF_TOKEN")
if not token and os.path.exists("/tmp/hftok"):
    token = open("/tmp/hftok").read().strip()

client = Client("VAST-AI/TripoSplat", token=token, verbose=False)
print(f"generating from {os.path.basename(inp)} (seed={seed} steps={steps} "
      f"guidance={guidance} gaussians={ngauss}) …", flush=True)

result = client.predict(
    image=handle_file(inp),
    seed=seed,
    steps=steps,
    guidance_scale=guidance,
    num_gaussians=ngauss,
    output_format="ply",
    api_name="/generate",
)

# result is a tuple of outputs (3 filepaths + 1 status string). Inspect + pick .ply
print("raw outputs:")
ply = None
items = result if isinstance(result, (list, tuple)) else [result]
for i, it in enumerate(items):
    path = it.get("path") if isinstance(it, dict) else it
    if isinstance(path, str) and os.path.exists(path):
        sz = os.path.getsize(path)
        print(f"  [{i}] {path}  ({sz/1024/1024:.2f} MB)")
        if path.lower().endswith(".ply"):
            ply = path
    else:
        print(f"  [{i}] {repr(it)[:120]}")

if not ply:
    # fall back to the largest existing file output
    cand = []
    for it in items:
        p = it.get("path") if isinstance(it, dict) else it
        if isinstance(p, str) and os.path.exists(p):
            cand.append((os.path.getsize(p), p))
    if cand:
        ply = max(cand)[1]

if not ply:
    print("ERROR: no .ply output found", file=sys.stderr); sys.exit(1)

os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
shutil.copyfile(ply, out)
print(f"saved -> {out}  ({os.path.getsize(out)/1024/1024:.2f} MB)")
