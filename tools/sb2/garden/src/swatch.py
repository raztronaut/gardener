"""Garden Edition swatch: every colour the skin draws with (SNES BGR555-exact via C()).

Colours come from the wall (public/styles.css): mint #74f7b0, teal #43e6c6, the deep
forest greens of the dark wall, gold #ffd98a, rose #ff9bb0 — plus the garden's soils,
stones, terracotta, petals, sunflower golds and pond blues.
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
from gfx import C  # noqa: E402

# ---- ink -------------------------------------------------------------------------------
NIGHT = C('#06140f')       # deepest outline (the wall's --bg-0)
INK = C('#0e2a1e')         # dark green outline
INK_BROWN = C('#2a160c')   # outline for soil / wood
WHITE = C('#ffffff')
CREAM = C('#fff6dc')

# ---- foliage -----------------------------------------------------------------------------
LEAF_0 = C('#0f3a24')      # deep forest
LEAF_1 = C('#1d5c34')
LEAF_2 = C('#2e8440')
LEAF_3 = C('#4cae4a')
LEAF_4 = C('#86d65e')
LEAF_5 = C('#c4f07a')      # sunlit tip
MINT = C('#74f7b0')
MINT_D = C('#3cc488')
TEAL = C('#43e6c6')
TEAL_D = C('#21998a')
MOSS = C('#6a8a2a')
MOSS_L = C('#9cba48')
OLIVE = C('#4a5e1c')

# ---- soil / wood ---------------------------------------------------------------------------
SOIL_0 = C('#2c1a10')
SOIL_1 = C('#4a2c18')
SOIL_2 = C('#6a4224')
SOIL_3 = C('#8c5c32')
SOIL_4 = C('#b07c44')
SAND_0 = C('#a8844e')
SAND_1 = C('#c8a466')
SAND_2 = C('#e2c48a')
SAND_3 = C('#f2deae')
WOOD_0 = C('#3c2210')
WOOD_1 = C('#6c4020')
WOOD_2 = C('#9a6430')
WOOD_3 = C('#c89050')
STRAW_0 = C('#9a6a1c')
STRAW_1 = C('#d0a03a')
STRAW_2 = C('#f0cc62')
STRAW_3 = C('#fff0a0')

# ---- stone ---------------------------------------------------------------------------------
STONE_0 = C('#2c3634')
STONE_1 = C('#4c5a56')
STONE_2 = C('#728079')
STONE_3 = C('#9eaaa2')
STONE_4 = C('#c8d2c8')
STONE_5 = C('#e8eee4')
SLATE_0 = C('#283040')
SLATE_1 = C('#46546a')
SLATE_2 = C('#6a7c94')

# ---- terracotta / brick -----------------------------------------------------------------
TERRA_0 = C('#5a2414')
TERRA_1 = C('#8e3a20')
TERRA_2 = C('#c0582e')
TERRA_3 = C('#e08048')
TERRA_4 = C('#f4b07a')

# ---- petals ------------------------------------------------------------------------------
ROSE_0 = C('#6a1434')
ROSE_1 = C('#a8284e')
ROSE_2 = C('#e04a76')
PINK = C('#ff8eaa')        # ~ the wall's --rose
PINK_L = C('#ffc8d6')
LILAC_0 = C('#3c2050')
LILAC_1 = C('#6a4296')
LILAC_2 = C('#9a78d0')
LILAC_3 = C('#cab4f2')
RED = C('#e02c2c')
RED_D = C('#8a1418')
ORANGE = C('#ff8a1e')

# ---- sunflower gold --------------------------------------------------------------------------
GOLD_0 = C('#8a4a08')
GOLD_1 = C('#d07c10')
GOLD_2 = C('#f8b224')
GOLD_3 = C('#ffd84a')      # ~ the wall's --gold, more saturated
GOLD_4 = C('#fff08c')
GOLD_5 = C('#fffbd8')

# ---- water / sky -------------------------------------------------------------------------------
WATER_0 = C('#0a2a52')
WATER_1 = C('#14508c')
WATER_2 = C('#2a80c8')
WATER_3 = C('#5cb4ec')
WATER_4 = C('#a4e0fa')
WATER_5 = C('#e2f8ff')
ICE_0 = C('#5a8cb8')
ICE_1 = C('#8cc0e4')
ICE_2 = C('#bde2f6')
ICE_3 = C('#e6f6ff')

# ---- seed pod (the bomb) ------------------------------------------------------------------
POD_0 = C('#1c0e1e')       # outline
POD_1 = C('#3a1c3e')       # body dark
POD_2 = C('#683a6a')       # body
POD_3 = C('#a476a0')       # rim light
