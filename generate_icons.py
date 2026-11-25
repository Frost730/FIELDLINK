import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SIZE = 512

def create_base_canvas(bg_color=(10, 14, 20)):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Squircle / rounded rectangle with 110px radius
    draw.rounded_rectangle([16, 16, SIZE-16, SIZE-16], radius=110, fill=bg_color)
    # Outer tactical rim
    draw.rounded_rectangle([16, 16, SIZE-16, SIZE-16], radius=110, outline=(35, 48, 71, 255), width=4)
    # Inner border
    draw.rounded_rectangle([26, 26, SIZE-26, SIZE-26], radius=100, outline=(20, 28, 42, 255), width=2)
    return img, draw

# ==============================================================================
# DESIGN 1: "ATAK APEX" - Stealth Radar Reticle & Glowing Recon Arrow
# ==============================================================================
def render_design_1():
    img, draw = create_base_canvas(bg_color=(9, 13, 19))
    cx, cy = SIZE // 2, SIZE // 2

    # Radar rings
    for r in [180, 125, 70]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(22, 38, 56, 255), width=3)
    
    # 4 Cardinal Reticle Ticks
    tick_len = 28
    draw.line([cx, 32, cx, 32 + tick_len], fill=(6, 182, 212, 255), width=4)
    draw.line([cx, SIZE - 32 - tick_len, cx, SIZE - 32], fill=(6, 182, 212, 255), width=4)
    draw.line([32, cy, 32 + tick_len, cy], fill=(6, 182, 212, 255), width=4)
    draw.line([SIZE - 32 - tick_len, cy, SIZE - 32, cy], fill=(6, 182, 212, 255), width=4)

    # 4 MGRS Corner crosshairs
    for x, y in [(75, 75), (SIZE-75, 75), (75, SIZE-75), (SIZE-75, SIZE-75)]:
        draw.line([x - 12, y, x + 12, y], fill=(16, 185, 129, 140), width=2)
        draw.line([x, y - 12, x, y + 12], fill=(16, 185, 129, 140), width=2)

    # Glowing Apex Chevron
    # Glow layer
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    chevron_points = [
        (cx, cy - 110),       # Apex top tip
        (cx + 90, cy + 95),   # Right wing
        (cx, cy + 50),        # Center inner notch
        (cx - 90, cy + 95)    # Left wing
    ]
    gdraw.polygon(chevron_points, fill=(6, 182, 212, 180))
    glow = glow.filter(ImageFilter.GaussianBlur(16))
    img.alpha_composite(glow)

    # Sharp Solid Chevron with gradient shading
    draw = ImageDraw.Draw(img)
    # Right half (darker cyan)
    draw.polygon([(cx, cy - 110), (cx + 90, cy + 95), (cx, cy + 50)], fill=(2, 132, 199, 255))
    # Left half (bright cyan)
    draw.polygon([(cx, cy - 110), (cx, cy + 50), (cx - 90, cy + 95)], fill=(34, 211, 238, 255))
    # Outer crisp rim
    draw.polygon(chevron_points, outline=(255, 255, 255, 220), width=3)

    # Center tactical high-precision core dot
    draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=(255, 255, 255, 255))
    draw.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], outline=(16, 185, 129, 255), width=2)

    return img

# ==============================================================================
# DESIGN 2: "SENTINEL MESH" - Hexagonal Mesh Network & Constellation Nodes
# ==============================================================================
def render_design_2():
    img, draw = create_base_canvas(bg_color=(8, 12, 16))
    cx, cy = SIZE // 2, SIZE // 2

    # Tactical Hexagon perimeter
    hex_r = 195
    hex_pts = [
        (cx + hex_r * math.cos(math.radians(a)), cy + hex_r * math.sin(math.radians(a)))
        for a in range(30, 390, 60)
    ]
    draw.polygon(hex_pts, outline=(15, 23, 42, 255), fill=(10, 16, 24, 255))
    draw.polygon(hex_pts, outline=(30, 58, 88, 255), width=4)

    # Inner hex
    inner_r = 175
    inner_pts = [
        (cx + inner_r * math.cos(math.radians(a)), cy + inner_r * math.sin(math.radians(a)))
        for a in range(30, 390, 60)
    ]
    draw.polygon(inner_pts, outline=(14, 165, 233, 100), width=2)

    # Mesh Node positions (Central operator + 5 squad satellites)
    nodes = [
        (cx, cy - 105),       # North Squad
        (cx + 105, cy - 40),  # North-East Squad
        (cx + 80, cy + 90),   # South-East Squad
        (cx - 80, cy + 90),   # South-West Squad
        (cx - 105, cy - 40),  # North-West Squad
    ]

    # Interconnect lines
    for i in range(len(nodes)):
        p1 = nodes[i]
        # Line to center
        draw.line([cx, cy, p1[0], p1[1]], fill=(14, 165, 233, 180), width=3)
        # Line to neighbor
        p2 = nodes[(i + 1) % len(nodes)]
        draw.line([p1[0], p1[1], p2[0], p2[1]], fill=(6, 182, 212, 100), width=2)

    # Center Central Operator Hub
    draw.ellipse([cx - 45, cy - 45, cx + 45, cy + 45], fill=(3, 105, 161, 80), outline=(56, 189, 248, 255), width=3)
    draw.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], fill=(245, 158, 11, 255))
    draw.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=(255, 255, 255, 255))

    # Satellite squad nodes
    for nx, ny in nodes:
        draw.ellipse([nx - 22, ny - 22, nx + 22, ny + 22], fill=(8, 47, 73, 200), outline=(6, 182, 212, 255), width=3)
        draw.ellipse([nx - 10, ny - 10, nx + 10, ny + 10], fill=(34, 211, 238, 255))
        draw.ellipse([nx - 4, ny - 4, nx + 4, ny + 4], fill=(255, 255, 255, 255))

    # Label text or badge
    # Top signal pulse
    for r in [55, 75]:
        draw.arc([cx - r, cy - r, cx + r, cy + r], start=210, end=330, fill=(245, 158, 11, 200), width=3)

    return img

# ==============================================================================
# DESIGN 3: "TITAN SPEAR" - Stealth Delta Wing & Tactical OD Green Grid
# ==============================================================================
def render_design_3():
    img, draw = create_base_canvas(bg_color=(12, 17, 14))
    cx, cy = SIZE // 2, SIZE // 2

    # Tactical OD green border
    draw.rounded_rectangle([16, 16, SIZE-16, SIZE-16], radius=110, outline=(42, 64, 46, 255), width=5)
    draw.rounded_rectangle([28, 28, SIZE-28, SIZE-28], radius=98, outline=(24, 38, 27, 255), width=2)

    # Coordinate Grid lines (OD / Emerald)
    grid_steps = [120, 185, 256, 327, 392]
    for gx in grid_steps:
        draw.line([gx, 40, gx, SIZE-40], fill=(24, 45, 28, 200), width=2)
    for gy in grid_steps:
        draw.line([40, gy, SIZE-40, gy], fill=(24, 45, 28, 200), width=2)

    # Stealth Supersonic Spearhead / Delta (Sharp military patch look)
    # Background Glow
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    delta_pts = [
        (cx, cy - 130),       # High sharp apex
        (cx + 100, cy + 90),  # Right bottom fin
        (cx + 35, cy + 60),   # Right inner stepped fin
        (cx, cy + 85),        # Center notch
        (cx - 35, cy + 60),   # Left inner stepped fin
        (cx - 100, cy + 90)   # Left bottom fin
    ]
    gdraw.polygon(delta_pts, fill=(34, 197, 94, 160))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    img.alpha_composite(glow)

    draw = ImageDraw.Draw(img)
    # Right facet (Dark tactical forest green)
    draw.polygon([(cx, cy - 130), (cx + 100, cy + 90), (cx + 35, cy + 60), (cx, cy + 85)], fill=(21, 128, 61, 255))
    # Left facet (Bright tactical phosphor green)
    draw.polygon([(cx, cy - 130), (cx, cy + 85), (cx - 35, cy + 60), (cx - 100, cy + 90)], fill=(74, 222, 128, 255))
    # Crisp outline
    draw.polygon(delta_pts, outline=(240, 253, 244, 240), width=3)

    # Center vertical laser groove / negative slit
    draw.line([cx, cy - 80, cx, cy + 50], fill=(12, 17, 14, 255), width=6)
    draw.line([cx, cy - 80, cx, cy + 50], fill=(240, 253, 244, 255), width=2)

    # Core target diamond
    draw.polygon([(cx, cy - 20), (cx + 14, cy), (cx, cy + 20), (cx - 14, cy)], fill=(255, 255, 255, 255))

    return img

# ==============================================================================
# DESIGN 4: "VANGUARD DIAL" - Milspec Compass Dial & Interceptor Reticle
# ==============================================================================
def render_design_4():
    img, draw = create_base_canvas(bg_color=(10, 13, 18))
    cx, cy = SIZE // 2, SIZE // 2

    # Outer Compass Graduation Ring
    r_outer = 195
    draw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], outline=(30, 41, 59, 255), width=4)
    draw.ellipse([cx - 170, cy - 170, cx + 170, cy + 170], outline=(15, 23, 42, 255), width=2)

    # 360-degree ticks
    for deg in range(0, 360, 15):
        rad = math.radians(deg)
        is_cardinal = (deg % 90 == 0)
        len_tick = 22 if is_cardinal else (14 if deg % 30 == 0 else 8)
        color = (245, 158, 11, 255) if is_cardinal else (71, 85, 105, 220)
        thick = 4 if is_cardinal else (3 if deg % 30 == 0 else 2)
        
        x1 = cx + (r_outer - 5) * math.cos(rad)
        y1 = cy + (r_outer - 5) * math.sin(rad)
        x2 = cx + (r_outer - 5 - len_tick) * math.cos(rad)
        y2 = cy + (r_outer - 5 - len_tick) * math.sin(rad)
        draw.line([x1, y1, x2, y2], fill=color, width=thick)

    # Tactical Inner Dial
    draw.ellipse([cx - 120, cy - 120, cx + 120, cy + 120], fill=(13, 20, 30, 255), outline=(6, 182, 212, 180), width=3)

    # 4-Quadrant Reticle Crosshairs with gap in center
    ch_gap = 35
    ch_outer = 115
    # North
    draw.line([cx, cy - ch_outer, cx, cy - ch_gap], fill=(6, 182, 212, 255), width=4)
    # South
    draw.line([cx, cy + ch_gap, cx, cy + ch_outer], fill=(6, 182, 212, 255), width=4)
    # West
    draw.line([cx - ch_outer, cy, cx - ch_gap, cy], fill=(6, 182, 212, 255), width=4)
    # East
    draw.line([cx + ch_gap, cy, cx + ch_outer, cy], fill=(6, 182, 212, 255), width=4)

    # Glowing Red-Orange North Needle
    draw.polygon([(cx, cy - 95), (cx + 18, cy - 10), (cx, cy - 25)], fill=(239, 68, 68, 255))
    draw.polygon([(cx, cy - 95), (cx - 18, cy - 10), (cx, cy - 25)], fill=(248, 113, 113, 255))
    # South Needle (Subtle white/gray)
    draw.polygon([(cx, cy + 95), (cx + 18, cy + 10), (cx, cy + 25)], fill=(148, 163, 184, 255))
    draw.polygon([(cx, cy + 95), (cx - 18, cy + 10), (cx, cy + 25)], fill=(203, 213, 225, 255))

    # Center target lock circle
    draw.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], outline=(245, 158, 11, 255), width=3)
    draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=(245, 158, 11, 255))

    return img

# Save all designs
des1 = render_design_1()
des1.save("C:/Projects/FIELDLINK/public/icon_options/design_1_apex.png")

des2 = render_design_2()
des2.save("C:/Projects/FIELDLINK/public/icon_options/design_2_mesh.png")

des3 = render_design_3()
des3.save("C:/Projects/FIELDLINK/public/icon_options/design_3_spear.png")

des4 = render_design_4()
des4.save("C:/Projects/FIELDLINK/public/icon_options/design_4_vanguard.png")

# Also copy to Artifact directory so they render cleanly in chat
art_dir = "C:/Users/user/.gemini/antigravity/brain/39ec3617-03ef-4315-8b3b-b9a54810cd8e"
des1.save(f"{art_dir}/design_1_apex.png")
des2.save(f"{art_dir}/design_2_mesh.png")
des3.save(f"{art_dir}/design_3_spear.png")
des4.save(f"{art_dir}/design_4_vanguard.png")

# Create a consolidated 2x2 comparison grid image
grid_img = Image.new("RGBA", (1100, 1100), (8, 11, 15, 255))
draw_grid = ImageDraw.Draw(grid_img)

grid_img.paste(des1, (25, 25))
grid_img.paste(des2, (565, 25))
grid_img.paste(des3, (25, 565))
grid_img.paste(des4, (565, 565))

grid_img.save("C:/Projects/FIELDLINK/public/icon_options/icon_showcase_grid.png")
grid_img.save(f"{art_dir}/icon_showcase_grid.png")

print("All 4 tactical icon options rendered successfully!")
