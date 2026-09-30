#!/usr/bin/env python3
"""Regenerate Hive application icons from the shared 1024px mark."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps/android/assets/icons"
MASTER_SIZE = 1024


def build_master() -> Image.Image:
    image = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), "#101512")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 1023, 1023), radius=230, fill="#101512")

    surface = Image.new("RGBA", image.size)
    surface_draw = ImageDraw.Draw(surface)
    for y in range(MASTER_SIZE):
        t = y / (MASTER_SIZE - 1)
        start = (30, 39, 27)
        end = (16, 21, 18)
        color = tuple(round(a + (b - a) * t) for a, b in zip(start, end)) + (255,)
        surface_draw.line((0, y, MASTER_SIZE, y), fill=color)
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1023, 1023), radius=230, fill=255)
    image = Image.composite(surface, image, mask)

    tile = Image.new("RGBA", image.size)
    tile_draw = ImageDraw.Draw(tile)
    for y in range(160, 864):
        t = (y - 160) / 703
        start = (202, 255, 146)
        end = (167, 223, 104)
        color = tuple(round(a + (b - a) * t) for a, b in zip(start, end)) + (255,)
        tile_draw.line((160, y, 864, y), fill=color)
    tile_mask = Image.new("L", image.size)
    ImageDraw.Draw(tile_mask).rounded_rectangle((160, 160, 863, 863), radius=190, fill=255)
    image = Image.alpha_composite(image, Image.composite(tile, Image.new("RGBA", image.size), tile_mask))

    mark = Image.new("RGBA", image.size)
    mark_draw = ImageDraw.Draw(mark)
    mark_draw.polygon(
        [(300, 270), (426, 270), (426, 465), (598, 465), (598, 270), (724, 270),
         (724, 754), (598, 754), (598, 578), (426, 578), (426, 754), (300, 754)],
        fill="#101512",
    )
    image = Image.alpha_composite(image, mark)
    return image


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    master = build_master()
    sizes = (64, 128, 256, 512)
    rendered = {}
    for size in sizes:
        icon = master.resize((size, size), Image.Resampling.LANCZOS)
        rendered[size] = icon
        icon.save(OUTPUT / f"hive-{size}.png", optimize=True)
    rendered[512].save(OUTPUT / "hive.ico", format="ICO", sizes=[(size, size) for size in sizes])
    for dpi, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        rendered_icon = master.resize((size, size), Image.Resampling.LANCZOS)
        rendered_icon.save(OUTPUT / f"hive-{dpi}.png", optimize=True)
        rendered_icon.save(OUTPUT / f"hive-{dpi}.webp", format="WEBP", quality=95, method=6)
    print(f"Generated Hive icons in {OUTPUT}")


if __name__ == "__main__":
    main()
