import math
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
ART_DIR = "C:/Users/user/.gemini/antigravity/brain/39ec3617-03ef-4315-8b3b-b9a54810cd8e"
PUB_DIR = "C:/Projects/FIELDLINK/public/icon_options"

# Common helper for rounded tactical squircle
def create_tactical_canvas(bg_color, rim_color, inner_rim_color=None):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Outer squircle
    draw.rounded_rectangle([18, 18, SIZE-18, SIZE-18], radius=108, fill=bg_color)
    draw.rounded_rectangle([18, 18, SIZE-18, SIZE-18], radius=108, outline=rim_color, width=6)
    
    if inner_rim_color:
        draw.rounded_rectangle([32, 32, SIZE-32, SIZE-32], radius=94, outline=inner_rim_color, width=2)
        
    return img, draw

# ==============================================================================
# DESIGN 1: "ATAK MIL-SPEC CREST" (Official ATAK Shield / Ranger Green & Tan)
# ==============================================================================
def render_atak_milspec():
    # Matte Ranger Green background & Coyote Tan rim
    bg = (38, 48, 36)         # Deep Ranger Green
    rim = (176, 154, 124)     # Subdued Coyote Tan
    inner = (58, 74, 55)      # Olive inner ring
    img, draw = create_tactical_canvas(bg, rim, inner)
    cx, cy = SIZE // 2, SIZE // 2

    # Draw Military Crest / Shield shape
    shield_pts = [
        (cx, cy - 180),       # Top center point
        (cx + 150, cy - 140), # Top right corner
        (cx + 150, cy + 30),  # Right waist
        (cx, cy + 185),       # Bottom spear point
        (cx - 150, cy + 30),  # Left waist
        (cx - 150, cy - 140)  # Top left corner
    ]
    draw.polygon(shield_pts, fill=(28, 36, 26), outline=(176, 154, 124), width=4)

    # Tactical Global Grid Lines (ATAK style geospatial arcs)
    # Latitude arcs
    draw.arc([cx - 110, cy - 110, cx + 110, cy + 110], start=0, end=360, fill=(65, 84, 62), width=2)
    draw.arc([cx - 70, cy - 70, cx + 70, cy + 70], start=0, end=360, fill=(65, 84, 62), width=2)
    # Longitude ellipse
    draw.ellipse([cx - 45, cy - 110, cx + 45, cy + 110], outline=(65, 84, 62), width=2)
    # Equator line
    draw.line([cx - 110, cy, cx + 110, cy], fill=(65, 84, 62), width=2)

    # 4 Precision Milspec Crosshairs
    draw.line([cx, cy - 160, cx, cy - 120], fill=(176, 154, 124), width=4)
    draw.line([cx, cy + 120, cx, cy + 160], fill=(176, 154, 124), width=4)
    draw.line([cx - 140, cy, cx - 100, cy], fill=(176, 154, 124), width=4)
    draw.line([cx + 100, cy, cx + 140, cy], fill=(176, 154, 124), width=4)

    # Real ATAK Arrowhead / Locator Cursor (Two-tone Desert Tan & Bone)
    arrow_tip = (cx, cy - 90)
    arrow_r = (cx + 65, cy + 70)
    arrow_notch = (cx, cy + 35)
    arrow_l = (cx - 65, cy + 70)

    # Right facet (Darker tan)
    draw.polygon([arrow_tip, arrow_r, arrow_notch], fill=(158, 136, 107))
    # Left facet (Bright bone tan)
    draw.polygon([arrow_tip, arrow_notch, arrow_l], fill=(225, 212, 190))
    # Crisp outer outline
    draw.polygon([arrow_tip, arrow_r, arrow_notch, arrow_l], outline=(245, 238, 225), width=3)

    # Central targeting dot
    draw.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=(225, 29, 72))  # Subdued crimson target lock

    return img

# ==============================================================================
# DESIGN 2: "COYOTE RECON DELTA" (US Marine / Army Tactical Tan & OD Stencil)
# ==============================================================================
def render_coyote_recon():
    # Matte Coyote Brown / Ballistic Tan plate
    bg = (54, 43, 33)         # Matte Dark Coyote Brown
    rim = (195, 178, 148)     # Desert Sand Tan
    inner = (78, 62, 48)      # Earth inner border
    img, draw = create_tactical_canvas(bg, rim, inner)
    cx, cy = SIZE // 2, SIZE // 2

    # Corner mounting hardware / hex rivets
    for rx, ry in [(52, 52), (SIZE-52, 52), (52, SIZE-52), (SIZE-52, SIZE-52)]:
        draw.ellipse([rx - 8, ry - 8, rx + 8, ry + 8], fill=(35, 28, 21), outline=(130, 114, 92), width=2)
        draw.line([rx - 5, ry, rx + 5, ry], fill=(130, 114, 92), width=2)

    # Concentric Ranging Circles
    for r in [170, 115, 60]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(78, 65, 52), width=3)

    # Cardinal Reticle ticks with MGRS style
    for deg in range(0, 360, 45):
        rad = math.radians(deg)
        r1, r2 = 155, 175
        draw.line([cx + r1*math.cos(rad), cy + r1*math.sin(rad), cx + r2*math.cos(rad), cy + r2*math.sin(rad)], fill=(195, 178, 148), width=3)

    # Tier-1 Special Operations Chevron (Subdued OD & Tan Dual Chevron)
    # Primary Chevron
    chev_pts = [
        (cx, cy - 115),
        (cx + 90, cy + 65),
        (cx + 60, cy + 85),
        (cx, cy - 25),
        (cx - 60, cy + 85),
        (cx - 90, cy + 65)
    ]
    draw.polygon(chev_pts, fill=(72, 88, 66), outline=(215, 200, 175), width=3)

    # Secondary Support Chevron below
    chev2_pts = [
        (cx, cy + 20),
        (cx + 70, cy + 125),
        (cx + 45, cy + 140),
        (cx, cy + 70),
        (cx - 45, cy + 140),
        (cx - 70, cy + 125)
    ]
    draw.polygon(chev2_pts, fill=(160, 140, 110), outline=(215, 200, 175), width=2)

    # Center white precision beacon dot
    draw.ellipse([cx - 8, cy - 30, cx + 8, cy - 14], fill=(255, 255, 255))
    draw.ellipse([cx - 16, cy - 38, cx + 16, cy - 6], outline=(215, 200, 175), width=2)

    return img

# ==============================================================================
# DESIGN 3: "TACTICAL MESH SPEAR" (Special Ops Signals / Blackout & Subdued OD)
# ==============================================================================
def render_tactical_mesh_spear():
    # Matte Night Ops Charcoal / Blackout
    bg = (20, 24, 21)         # Deep Gunmetal Blackout
    rim = (76, 96, 72)        # Milspec OD Green
    inner = (34, 42, 35)      # Foliage Green inner
    img, draw = create_tactical_canvas(bg, rim, inner)
    cx, cy = SIZE // 2, SIZE // 2

    # MGRS Grid Background in subdued night-vision green
    for gx in [110, 180, 256, 332, 402]:
        draw.line([gx, 45, gx, SIZE-45], fill=(30, 40, 32), width=2)
    for gy in [110, 180, 256, 332, 402]:
        draw.line([45, gy, SIZE-45, gy], fill=(30, 40, 32), width=2)

    # Radio Mesh Waves (Signals / Communications arcs)
    for r in [90, 130, 170]:
        draw.arc([cx - r, cy - r, cx + r, cy + r], start=210, end=330, fill=(76, 120, 72), width=3)
        draw.arc([cx - r, cy - r, cx + r, cy + r], start=30, end=150, fill=(76, 120, 72), width=3)

    # Combat Dagger / Spearhead Locator (Modern Tactical ATAK Cursor)
    spear_pts = [
        (cx, cy - 130),       # Spear top tip
        (cx + 80, cy + 70),   # Right fin
        (cx + 30, cy + 50),   # Right inner step
        (cx, cy + 80),        # Center notch
        (cx - 30, cy + 50),   # Left inner step
        (cx - 80, cy + 70)    # Left fin
    ]

    # Two-tone matte military green & desert sand
    draw.polygon([(cx, cy - 130), (cx + 80, cy + 70), (cx + 30, cy + 50), (cx, cy + 80)], fill=(45, 62, 42))
    draw.polygon([(cx, cy - 130), (cx, cy + 80), (cx - 30, cy + 50), (cx - 80, cy + 70)], fill=(92, 125, 86))
    draw.polygon(spear_pts, outline=(225, 235, 220), width=3)

    # Vertical laser grooving
    draw.line([cx, cy - 90, cx, cy + 45], fill=(225, 235, 220), width=3)

    # Center target lock reticle ring (Amber alert)
    draw.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], outline=(217, 119, 6), width=3)
    draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=(255, 255, 255))

    return img

# ==============================================================================
# DESIGN 4: "AIRBORNE TAK COMPASS" (Foliage Green & Subdued Milspec Gold)
# ==============================================================================
def render_airborne_tak():
    # Matte Foliage Green & Milspec Subdued Brass/Gold
    bg = (32, 42, 34)         # Foliage Green
    rim = (190, 160, 95)      # Subdued Military Brass
    inner = (48, 62, 50)      # Muted green inner rim
    img, draw = create_tactical_canvas(bg, rim, inner)
    cx, cy = SIZE // 2, SIZE // 2

    # Outer 360-degree Milspec Compass Dial
    r_dial = 180
    draw.ellipse([cx - r_dial, cy - r_dial, cx + r_dial, cy + r_dial], outline=(190, 160, 95), width=3)
    draw.ellipse([cx - 155, cy - 155, cx + 155, cy + 155], outline=(48, 65, 50), width=2)

    # 12 Major Compass Ticks
    for deg in range(0, 360, 30):
        rad = math.radians(deg)
        is_card = (deg % 90 == 0)
        len_t = 24 if is_card else 14
        col = (235, 205, 130) if is_card else (135, 150, 130)
        w = 4 if is_card else 2
        x1 = cx + (r_dial - 4) * math.cos(rad)
        y1 = cy + (r_dial - 4) * math.sin(rad)
        x2 = cx + (r_dial - 4 - len_t) * math.cos(rad)
        y2 = cy + (r_dial - 4 - len_t) * math.sin(rad)
        draw.line([x1, y1, x2, y2], fill=col, width=w)

    # Subdued Cardinal Text markers (N, S, E, W) using geometric lines
    # North "N" mark
    draw.line([cx - 8, cy - 148, cx - 8, cy - 132], fill=(235, 205, 130), width=3)
    draw.line([cx - 8, cy - 148, cx + 8, cy - 132], fill=(235, 205, 130), width=3)
    draw.line([cx + 8, cy - 148, cx + 8, cy - 132], fill=(235, 205, 130), width=3)

    # Tactical Reticle Lines (with gap for pointer)
    draw.line([cx, cy - 125, cx, cy - 70], fill=(190, 160, 95), width=3)
    draw.line([cx, cy + 70, cx, cy + 125], fill=(190, 160, 95), width=3)
    draw.line([cx - 125, cy, cx - 70, cy], fill=(190, 160, 95), width=3)
    draw.line([cx + 70, cy, cx + 125, cy], fill=(190, 160, 95), width=3)

    # Airborne / Special Operations Arrow (Two-tone Subdued Gold & Olive)
    # North Arrow
    draw.polygon([(cx, cy - 90), (cx + 35, cy + 45), (cx, cy + 20)], fill=(160, 130, 70))
    draw.polygon([(cx, cy - 90), (cx, cy + 20), (cx - 35, cy + 45)], fill=(225, 195, 120))
    # South Counter-balance fin
    draw.polygon([(cx, cy + 70), (cx + 20, cy + 30), (cx, cy + 38)], fill=(75, 95, 78))
    draw.polygon([(cx, cy + 70), (cx, cy + 38), (cx - 20, cy + 30)], fill=(95, 120, 100))

    # Overall border
    draw.polygon([(cx, cy - 90), (cx + 35, cy + 45), (cx, cy + 20), (cx + 20, cy + 30), (cx, cy + 70), (cx - 20, cy + 30), (cx, cy + 20), (cx - 35, cy + 45)], outline=(245, 235, 200), width=2)

    # Center core ring
    draw.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], fill=(28, 38, 30), outline=(235, 205, 130), width=3)
    draw.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(235, 205, 130))

    return img

# Render and save
atak1 = render_atak_milspec()
atak2 = render_coyote_recon()
atak3 = render_tactical_mesh_spear()
atak4 = render_airborne_tak()

atak1.save(f"{PUB_DIR}/atak_1_milspec_crest.png")
atak2.save(f"{PUB_DIR}/atak_2_coyote_recon.png")
atak3.save(f"{PUB_DIR}/atak_3_mesh_spear.png")
atak4.save(f"{PUB_DIR}/atak_4_airborne_compass.png")

atak1.save(f"{ART_DIR}/atak_1_milspec_crest.png")
atak2.save(f"{ART_DIR}/atak_2_coyote_recon.png")
atak3.save(f"{ART_DIR}/atak_3_mesh_spear.png")
atak4.save(f"{ART_DIR}/atak_4_airborne_compass.png")

# 2x2 Showcase Grid
grid_img = Image.new("RGBA", (1100, 1100), (16, 20, 17, 255))
grid_img.paste(atak1, (25, 25))
grid_img.paste(atak2, (565, 25))
grid_img.paste(atak3, (25, 565))
grid_img.paste(atak4, (565, 565))

grid_img.save(f"{PUB_DIR}/atak_military_grid.png")
grid_img.save(f"{ART_DIR}/atak_military_grid.png")

print("All 4 authentic ATAK military icons generated successfully!")
