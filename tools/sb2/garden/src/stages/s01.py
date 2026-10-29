"""Stage 1 — the KITCHEN GARDEN: sandy paths between the beds, round lettuce bushes with
white pea flowers (soft), stone planters with a sprout of chives (hard, and the ring),
a red-brick garden wall beyond."""
from common import *  # noqa: F401,F403

NAME = 'Kitchen Garden'

PLANTER = """
.oooooooooooooo.
o44444444444443o
o4oooooooooooo3o
o4oTTTTTTTTTTo3o
o4oTTTgTTTTlTo3o
o4oTTgLgTTlLlo3o
o4oTTgLgTTTlTo3o
o3oooooooooooo2o
o33333333333332o
o22222222222221o
o22232222223221o
o11111111111111o
o22222322222221o
o23222222232221o
o11111111111111o
.oooooooooooooo.
"""

def terrain(ctx):
    a = {}
    floor = speckle(16, 16, SAND_1, [(SAND_2, 3), (SAND_0, 2)], seed=11, density=0.09)
    pebbles(floor, (SAND_2, SAND_1, SAND_0), 2, seed=3)
    a['floor_0'] = floor
    a['floor_1'] = shadow_top(floor, [SAND_2, SAND_1, SAND_0], [SAND_1, SAND_0, SAND_0], rows=5)
    a['soft_block_0'] = over(floor.copy(), clump_bush([LEAF_1, LEAF_2, LEAF_3, LEAF_4], INK, flowers=(WHITE, SAND_2)))
    L = {'o': INK, '4': STONE_4, '3': STONE_3, '2': STONE_2, '1': STONE_1, 'T': TERRA_1, 'g': LEAF_2, 'L': LEAF_4, 'l': LEAF_3}
    a['hard_block_0'] = over(floor.copy(), grid(PLANTER, L))
    # beyond the ring: the red-brick garden wall seen from above
    a['border_0'] = bricks(16, 16, TERRA_2, SAND_0, TERRA_2, TERRA_1, seed=2)
    # the sudden-death block: a heavy terracotta-capped stone slab
    slab = grid(PLANTER.replace('T', '3').replace('g', '3').replace('L', '4').replace('l', '3'), L)
    slab = remap(slab, [STONE_4, STONE_3], [TERRA_2, TERRA_2])
    slab[1, 1:15] = STONE_4
    a['pressure_block'] = over(floor.copy(), slab)
    return a
