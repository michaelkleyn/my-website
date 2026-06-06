#!/usr/bin/env python3
# Crop a grid sprite-sheet of butterflies into one clean PNG per cell:
#   even grid crop -> trim transparent margins -> pad to a square with margin.
# Usage: python crop_grid.py SRC OUT_DIR COLS ROWS
import sys, os
from PIL import Image

src_path, out_dir, cols, rows = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
os.makedirs(out_dir, exist_ok=True)

src = Image.open(src_path).convert("RGBA")
W, H = src.size
cw, ch = W // cols, H // rows
print(f"image {W}x{H}  cell {cw}x{ch}  grid {cols}x{rows}")

MARGIN = 0.12  # fraction of subject size added as padding on each side
crops = []
for r in range(rows):
    for c in range(cols):
        cell = src.crop((c * cw, r * ch, c * cw + cw, r * ch + ch))
        bbox = cell.getbbox()  # non-transparent region
        sub = cell.crop(bbox) if bbox else cell
        w, h = sub.size
        side = max(w, h)
        pad = int(side * MARGIN)
        size = side + pad * 2
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(sub, ((size - w) // 2, (size - h) // 2), sub)
        name = f"cell_r{r}_c{c}.png"
        canvas.save(os.path.join(out_dir, name))
        crops.append((name, canvas, (w, h)))
        print(f"  {name}: trimmed {w}x{h} -> {size}x{size}")

# montage on white for quick visual QA
tile = 240
mW, mH = cols * tile, rows * tile
montage = Image.new("RGB", (mW, mH), (245, 245, 245))
for i, (name, im, _) in enumerate(crops):
    r, c = divmod(i, cols)
    t = im.copy()
    t.thumbnail((tile - 12, tile - 12))
    bg = Image.new("RGBA", (tile, tile), (255, 255, 255, 255))
    bg.paste(t, ((tile - t.width) // 2, (tile - t.height) // 2), t)
    montage.paste(bg.convert("RGB"), (c * tile, r * tile))
montage.save("/tmp/crops_montage.png")
print("montage -> /tmp/crops_montage.png")
