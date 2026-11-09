# Promotional images

Images for the app's listing in the Reddit Developer Platform app directory. They live here, not in `assets/`, because Devvit uploads everything in `assets/` with the app.

| File            | Size        | Use             |
| --------------- | ----------- | --------------- |
| `icon.png`      | 1024 × 1024 | App icon        |
| `tile.png`      | 560 × 256   | Tile image      |
| `featuring.png` | 1500 × 1000 | Featuring asset |

Each PNG is rendered from the SVG of the same name, which is the source to edit.

## Design

- **Mark:** a teal circular arrow (rotation) around an amber pushpin (pinned).
- **Palette:** navy background `#16294A` to `#0B1526`, teal `#2DD4BF`, amber `#FBBF24`, white `#F8FAFC`, muted `#B6C2D3`.
- **Contrast:** every text colour is at least 5:1 against the surface behind it, above the directory's 3:1 guidance, and each image stays readable in greyscale.
- **Font:** Segoe UI, so render on Windows for the PNGs to match.

## Re-exporting

Open the SVG in a Chromium browser with the viewport set to the image's exact size, and save a screenshot of the viewport at 1× scale as PNG. Keep each file under 800 KB.
