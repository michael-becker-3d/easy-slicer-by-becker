#!/usr/bin/env python3
"""20-mm-Kalibrierwürfel mit erhabenen X/Y/Z-Buchstaben (0,8 mm Relief)."""
from __future__ import annotations

import math
import struct
from pathlib import Path

Vec3 = tuple[float, float, float]
Vec2 = tuple[float, float]

CUBE = 20.0
DEPTH = 0.8
STROKE = 1.2
LETTER = 8.0
OUT = Path("artifacts/xyz-kalibrierwuerfel-20mm.stl")

triangles: list[tuple[Vec3, Vec3, Vec3]] = []


def add(a: Vec3, b: Vec3, c: Vec3) -> None:
    triangles.append((a, b, c))


def quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3) -> None:
    add(a, b, c)
    add(a, c, d)


def box(x0: float, y0: float, z0: float, x1: float, y1: float, z1: float) -> None:
    # Die Reihenfolge ist für den Slicer nicht kritisch; jede Seite ist ein
    # geschlossenes Viereck.
    quad((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0))  # unten
    quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))  # oben
    quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1))  # vorne
    quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1))  # hinten
    quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1))  # links
    quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1))  # rechts


def add3(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale3(a: Vec3, s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)


def point(origin: Vec3, u: Vec3, v: Vec3, x: float, y: float) -> Vec3:
    return add3(add3(origin, scale3(u, x)), scale3(v, y))


def prism(
    poly: list[Vec2],
    origin: Vec3,
    u: Vec3,
    v: Vec3,
    normal: Vec3,
    depth: float = DEPTH,
) -> None:
    """Zieht ein konvexes 2D-Polygon senkrecht aus der Würfelfläche heraus."""
    base = [point(origin, u, v, x, y) for x, y in poly]
    top = [add3(p, scale3(normal, depth)) for p in base]
    # Deckel und Boden
    for i in range(1, len(base) - 1):
        add(base[0], base[i + 1], base[i])
        add(top[0], top[i], top[i + 1])
    # Seitenwände
    for i in range(len(base)):
        j = (i + 1) % len(base)
        quad(base[i], base[j], top[j], top[i])


def stroke(a: Vec2, b: Vec2, width: float = STROKE) -> list[Vec2]:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1.0
    px, py = -dy / length * width / 2, dx / length * width / 2
    return [
        (a[0] + px, a[1] + py),
        (b[0] + px, b[1] + py),
        (b[0] - px, b[1] - py),
        (a[0] - px, a[1] - py),
    ]


def letter_x() -> list[list[Vec2]]:
    h = LETTER / 2
    return [stroke((-h, -h), (h, h)), stroke((-h, h), (h, -h))]


def letter_y() -> list[list[Vec2]]:
    h = LETTER / 2
    return [stroke((-h, h), (0, 0)), stroke((h, h), (0, 0)), stroke((0, 0), (0, -h))]


def letter_z() -> list[list[Vec2]]:
    h = LETTER / 2
    return [
        stroke((-h, h), (h, h)),
        stroke((h, h), (-h, -h)),
        stroke((-h, -h), (h, -h)),
    ]


# Würfelkörper
box(0.0, 0.0, 0.0, CUBE, CUBE, CUBE)

# X auf der vorderen Fläche (y = 0), nach außen in -Y
for poly in letter_x():
    prism(poly, (CUBE / 2, 0.0, CUBE / 2), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))

# Y auf der rechten Fläche (x = 20), nach außen in +X
for poly in letter_y():
    prism(poly, (CUBE, CUBE / 2, CUBE / 2), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0))

# Z auf der Oberseite (z = 20), nach außen in +Z
for poly in letter_z():
    prism(poly, (CUBE / 2, CUBE / 2, CUBE), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def normal(a: Vec3, b: Vec3, c: Vec3) -> Vec3:
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return (nx / length, ny / length, nz / length)


OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("wb") as fh:
    fh.write(b"Easy-Slicer XYZ calibration cube".ljust(80, b"\0"))
    fh.write(struct.pack("<I", len(triangles)))
    for a, b, c in triangles:
        n = normal(a, b, c)
        fh.write(struct.pack("<12fH", *n, *a, *b, *c, 0))

xs = [p[0] for tri in triangles for p in tri]
ys = [p[1] for tri in triangles for p in tri]
zs = [p[2] for tri in triangles for p in tri]
print(f"{OUT}: {len(triangles)} triangles")
print(f"bbox X {min(xs):.2f}..{max(xs):.2f}, Y {min(ys):.2f}..{max(ys):.2f}, Z {min(zs):.2f}..{max(zs):.2f}")
