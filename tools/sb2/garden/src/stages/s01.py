"""Stage 1 — the KITCHEN GARDEN: sandy paths between the beds, leafy lettuce bushes with
white pea flowers (soft), squared stone planters (hard, also the ring), a red-brick wall
beyond the ring."""
from common import *  # noqa: F401,F403

NAME = 'Kitchen Garden'


def terrain(ctx):
    a = {}
    floor = speckle(16, 16, SAND_1, [(SAND_2, 3), (SAND_0, 2)], seed=11, density=0.10)
    pebbles(floor, (SAND_2, SAND_1, SAND_0), 2, seed=3)
    a['floor_0'] = floor
    a['floor_1'] = shadow_top(floor, [SAND_2, SAND_1, SAND_0], [SAND_1, SAND_0, SAND_0], rows=5)
    a['soft_block_0'] = bush([LEAF_1, LEAF_2, LEAF_3, LEAF_4], INK, flowers=[(WHITE, SAND_2)], seed=7)
    a['hard_block_0'] = stone_block([INK, STONE_1, STONE_2, STONE_3, STONE_4], INK, seed=5)
    a['border_0'] = bricks(16, 16, TERRA_2, SAND_0, TERRA_2, TERRA_1, seed=2)
    a['pressure_block'] = stone_block([INK, TERRA_1, TERRA_2, STONE_3, STONE_4], INK, seed=9, cracks=False)
    return a
