import colorsys
import math
import struct
import zlib
from pathlib import Path


SIZE = 512
OUTPUT = Path(__file__).resolve().parents[1] / "src" / "rainbow_rings.png"


def chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def make_png(width: int, height: int, rgba: bytes) -> bytes:
    rows = []
    stride = width * 4
    for y in range(height):
        row = rgba[y * stride:(y + 1) * stride]
        rows.append(b"\x00" + row)
    raw = b"".join(rows)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )


def build_image(size: int) -> bytes:
    cx = size / 2
    cy = size / 2
    max_radius = size * 0.47
    data = bytearray(size * size * 4)

    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            r = math.hypot(dx, dy)
            angle = math.atan2(dy, dx)
            radial = r / max_radius
            swirl = angle / (2 * math.pi)

            band_wave = math.sin(radial * math.pi * 13.0 - swirl * math.pi * 4.0)
            bow = math.cos(radial * math.pi * 6.0 + swirl * math.pi * 7.0)
            hue = (radial * 0.9 + swirl * 0.75 + 0.08 * band_wave) % 1.0
            sat = min(1.0, 0.68 + 0.22 * bow + 0.1 * math.sin(radial * math.pi * 8.0))
            val = 0.08 + 0.92 * max(0.0, 1.0 - radial ** 1.85)
            val *= 0.84 + 0.16 * math.cos(radial * math.pi * 18.0)

            ring_mask = 0.5 + 0.5 * math.cos(radial * math.pi * 24.0 - swirl * math.pi * 2.0)
            sat = min(1.0, sat * (0.84 + 0.3 * ring_mask))
            val = min(1.0, val + 0.12 * ring_mask)

            if r > max_radius:
                fade = max(0.0, 1.0 - (r - max_radius) / (size * 0.08))
                val *= fade

            red, green, blue = colorsys.hsv_to_rgb(hue, max(0.0, sat), max(0.0, min(1.0, val)))
            offset = (y * size + x) * 4
            data[offset] = int(red * 255)
            data[offset + 1] = int(green * 255)
            data[offset + 2] = int(blue * 255)
            data[offset + 3] = 255

    return bytes(data)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    png = make_png(SIZE, SIZE, build_image(SIZE))
    OUTPUT.write_bytes(png)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
