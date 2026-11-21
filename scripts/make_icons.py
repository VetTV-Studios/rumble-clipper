"""Generate extension icons (pure stdlib PNG writer, no Pillow needed).

Design: dark rounded square, Rumble-green play/clip mark, scissors dot.
Drawn at 512px with SDF-style math, then box-downscaled to each size.
"""
import struct, zlib, math, os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
S = 512  # supersample canvas

def clamp(v): return max(0, min(255, int(round(v))))

def rounded_rect_alpha(x, y, s, r, pad):
    cx, cy = s / 2, s / 2
    hx, hy = s / 2 - pad, s / 2 - pad
    qx, qy = abs(x - cx) - (hx - r), abs(y - cy) - (hy - r)
    d = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
    return max(0.0, min(1.0, 0.5 - d))

def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / max(1e-9, vx * vx + vy * vy)))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))

def render(size):
    # render master at S, downscale by box average
    px = [[(0, 0, 0, 0)] * S for _ in range(S)]
    # play triangle (centred slightly right)
    tri = [(0.36 * S, 0.24 * S), (0.36 * S, 0.68 * S), (0.76 * S, 0.46 * S)]
    def in_tri(x, y):
        (x1, y1), (x2, y2), (x3, y3) = tri
        d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d
        b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d
        c = 1 - a - b
        return a >= 0 and b >= 0 and c >= 0
    for y in range(S):
        for x in range(S):
            a_bg = rounded_rect_alpha(x, y, S, 0.22 * S, 0.02 * S)
            if a_bg <= 0:
                continue
            # vertical gradient: deep charcoal-green -> black-green
            t = y / S
            r = 18 + 10 * (1 - t); g = 26 + 14 * (1 - t); b = 20 + 8 * (1 - t)
            # film-strip sprocket dots left edge
            # play triangle in Rumble green gradient
            if in_tri(x, y):
                gt = x / S
                r, g, b = 110 + 60 * gt, 190 + 40 * gt, 55 + 20 * gt
            # scissors: two rings + blades, bottom-right badge
            bx, by = 0.70 * S, 0.72 * S
            badge_r = 0.20 * S
            if math.hypot(x - bx, y - by) < badge_r:
                r, g, b = 245, 247, 245  # white badge
                # blades
                d1 = seg_dist(x, y, bx - 0.11 * S, by - 0.11 * S, bx + 0.10 * S, by + 0.08 * S)
                d2 = seg_dist(x, y, bx - 0.11 * S, by + 0.11 * S, bx + 0.10 * S, by - 0.08 * S)
                ring1 = abs(math.hypot(x - (bx - 0.12 * S), y - (by - 0.12 * S)) - 0.045 * S)
                ring2 = abs(math.hypot(x - (bx - 0.12 * S), y - (by + 0.12 * S)) - 0.045 * S)
                if min(d1, d2) < 0.018 * S or min(ring1, ring2) < 0.016 * S:
                    r, g, b = 24, 30, 24
            px[y][x] = (clamp(r), clamp(g), clamp(b), clamp(255 * a_bg))
    # box downscale
    f = S // size
    out = []
    for oy in range(size):
        row = []
        for ox in range(size):
            sr = sg = sb = sa = 0.0
            for dy in range(f):
                for dx in range(f):
                    r, g, b, a = px[oy * f + dy][ox * f + dx]
                    sr += r * a; sg += g * a; sb += b * a; sa += a
            if sa > 0:
                row.append((clamp(sr / sa), clamp(sg / sa), clamp(sb / sa), clamp(sa / (f * f))))
            else:
                row.append((0, 0, 0, 0))
        out.append(row)
    return out

def write_png(path, pixels):
    h = len(pixels); w = len(pixels[0])
    raw = b"".join(b"\x00" + b"".join(struct.pack("4B", *p) for p in row) for row in pixels)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)
    print("wrote", path, len(png), "bytes")

os.makedirs(OUT, exist_ok=True)
for size in (16, 32, 48, 128):
    write_png(os.path.join(OUT, f"icon{size}.png"), render(size))
# 440x280-ish store promo tile reuses 128 art name for convenience in docs
print("done")
