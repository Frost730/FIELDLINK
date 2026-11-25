import os
from PIL import Image, ImageDraw

RES_DIR = "C:/Projects/FIELDLINK/android/app/src/main/res"

# We have the 512x512 Option A full icon:
# C:/Projects/FIELDLINK/public/icon_options/atak_1_milspec_crest.png
full_icon = Image.open("C:/Projects/FIELDLINK/public/icon_options/atak_1_milspec_crest.png").convert("RGBA")

# Create a circular mask for round launcher
def make_round_icon(img):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse([2, 2, w - 2, h - 2], fill=255)
    round_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    round_img.paste(img, (0, 0), mask)
    # Add a clean border around round icon
    draw_round = ImageDraw.Draw(round_img)
    draw_round.ellipse([2, 2, w - 2, h - 2], outline=(176, 154, 124, 255), width=max(1, int(w * 0.015)))
    return round_img

# Create transparent foreground for adaptive icon
# In adaptive icon: canvas is 108dp, inner 72dp (center ~66%) is visible.
# Our full_icon has the squircle background. Let's make a foreground where the shield and content
# are on transparent background and scaled to fit the 72/108 safe zone.
def create_adaptive_foreground(size):
    # Scale full icon or its inner shield to fit comfortably inside 108dp (safe zone is center 66%)
    fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # We scale the 512 icon down to ~72% of the canvas size and paste in center
    target_inner_size = int(size * 0.72)
    scaled_content = full_icon.resize((target_inner_size, target_inner_size), Image.Resampling.LANCZOS)
    offset = (size - target_inner_size) // 2
    fg.paste(scaled_content, (offset, offset), scaled_content)
    return fg

densities = {
    "mdpi": {"legacy": 48, "fg": 108},
    "hdpi": {"legacy": 72, "fg": 162},
    "xhdpi": {"legacy": 96, "fg": 216},
    "xxhdpi": {"legacy": 144, "fg": 324},
    "xxxhdpi": {"legacy": 192, "fg": 432}
}

for density, sizes in densities.items():
    dir_path = os.path.join(RES_DIR, f"mipmap-{density}")
    os.makedirs(dir_path, exist_ok=True)
    
    # 1. Legacy Square Icon
    leg_size = sizes["legacy"]
    square_icon = full_icon.resize((leg_size, leg_size), Image.Resampling.LANCZOS)
    square_icon.save(os.path.join(dir_path, "ic_launcher.png"), "PNG")
    
    # 2. Legacy Round Icon
    round_icon = make_round_icon(square_icon)
    round_icon.save(os.path.join(dir_path, "ic_launcher_round.png"), "PNG")
    
    # 3. Adaptive Foreground Icon
    fg_size = sizes["fg"]
    fg_icon = create_adaptive_foreground(fg_size)
    fg_icon.save(os.path.join(dir_path, "ic_launcher_foreground.png"), "PNG")
    
    print(f"Generated mipmap-{density} icons (legacy: {leg_size}px, fg: {fg_size}px)")

# Also save high-res 512x512 for web favicon and assets
full_icon.save("C:/Projects/FIELDLINK/public/favicon.png", "PNG")
full_icon.save("C:/Projects/FIELDLINK/dist/favicon.png", "PNG")

print("All Android launcher and web icons successfully exported!")
