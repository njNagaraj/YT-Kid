# YT Video Processing Pipeline (Joiner & Watermark Remover)

A modular, high-performance Node.js pipeline for YouTube video preparation:
1. **Lossless Video Stitching**: Concatenate any number of video clips (`v1.mp4`, `v2.mp4`, etc.) losslessly using stream copy.
2. **Channel Intro Prepending**: Automatically adapts and prepends `channel_assets/channel_intro.mp4` to match clip aspect ratio and framerate.
3. **Gemini Watermark Removal**: Reverse alpha blending via `@pilio/gemini-watermark-remover` with fast temporal stabilization.
4. **Auto-Conflict Protection**: Automatically avoids overwriting outputs (renames to `output1_copy1.mp4`, `output1_copy2.mp4`, etc.).
5. **Technical Verification Reports**: Automatically inspects video streams and writes an audit report to `output/<folder>_report.json`.

---

## 📁 Directory Structure

```text
Video_Joiner/
├── channel_assets/
│   ├── channel_banner.png
│   ├── channel_intro.mp4       # Channel intro (automatically adapted & prepended)
│   └── channel_logo.png
├── input/
│   └── video1/                 # Place source clips here
│       ├── v1.mp4
│       ├── v2.mp4
│       └── ...
├── output/                     # Final videos & reports saved here
│   ├── output1.mp4
│   └── video1_report.json
├── src/
│   ├── media.mjs               # FFmpeg stream probe, intro adaptation, and concat
│   ├── paths.mjs               # Folder detection, sorting, and conflict resolution
│   └── watermark.mjs           # Logo removal engine & progress bar
├── index.mjs                   # Main orchestrator CLI
├── package.json
└── run.bat                     # One-click Windows runner
```

---

## 🎯 How to Use

### Method A: One-Click Windows (`run.bat`)
Double-click `run.bat`. You will be presented with 4 intuitive options:
- **`[1] Video Joiner Only`**: Instant lossless stream-copy stitching with channel intro. No watermark removal.
- **`[2] Video Joiner + Logo Remover (DEFAULT)`**: Pre-joins clips, removes watermark in a single fast browser pass, and prepends channel intro.
- **`[3] Clean Clip-by-Clip + Join`**: Cleans clips individually using parallel workers, then stitches with intro.
- **`[4] Verify Files & Generate Report`**: Inspects existing outputs and saves technical metadata.

### Method B: Command Line (PowerShell / Terminal)

```bash
# Option 2 (Default: Join first -> Clean once -> Prepend intro)
node index.mjs

# Option 1 (Instant lossless stitch only, no watermark removal)
node index.mjs join

# Option 3 (Clean clips individually with 2 parallel workers)
node index.mjs clean --workers 2

# Process a specific folder (e.g. video2)
node index.mjs -i video2
node index.mjs join -i video2

# Skip channel intro
node index.mjs --no-intro

# Custom output file name
node index.mjs -n my_custom_video.mp4

# Run with ultra-fast denoiser (no neural network overhead)
node index.mjs --none
```

---

## ⚙️ CLI Options Reference

| Option | Flag | Description | Default |
| :--- | :--- | :--- | :--- |
| `join` | `--join-only` | Option 1: Lossless concat only (skips watermark removal) | `false` |
| `full` | | Option 2: Join first -> clean once -> prepend intro | `true` |
| `clean` | `--clip-by-clip`| Option 3: Clean each clip in parallel, then stitch | `false` |
| `verify` | | Option 4: Probe files and write technical JSON report | `false` |
| `-i <folder>` | `--input` | Target input folder path or name | Latest `video*` |
| `-n <file>` | `--name` | Custom output file name | Derived (e.g. `output1.mp4`) |
| `--intro <path>` | | Explicit channel intro file path | `channel_assets/channel_intro.mp4` |
| `--no-intro` | | Skip channel intro prepending | `false` |
| `--workers <N>` | | Parallel workers for clip-by-clip mode (1 to 6) | `2` |
| `--fast` | | Fast temporal stabilization denoiser | `true` |
| `--none` | | Ultra-fast raw reverse alpha without denoiser | `false` |
| `--ai` | | Deep AI neural network denoiser (~15 min/clip CPU) | `false` |
| `-b <Mbps>` | `--bitrate` | Target bitrate in Mbps for watermark removal | `40` |
| `--keep-temp` | | Preserve temporary directories and manifests | `false` |
| `-h` | `--help` | Display help screen | |

---

## 🛡️ Conflict Resolution

If a target output (e.g. `output1.mp4`) already exists in `output/`, the pipeline will automatically prevent overwriting and create:
- `output1_copy1.mp4`
- `output1_copy2.mp4` (if copy1 already exists, and so forth)

Your original source clips in `input/` are **never modified or deleted**.
