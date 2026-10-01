# YT Video Processing Pipeline (Joiner & Parallel Cleaner)

A production-grade, system-optimized video preparation pipeline for YouTube:
1. **Resolution Source of Truth**: Detects whether the input clips are **Shorts** (9:16 vertical, e.g. 1080×1920) or **Full Video** (16:9 horizontal, e.g. 1920×1080), and dynamically zooms and center-crops `channel_assets/channel_intro.mp4` to fill the frame completely with **zero black bars / letterboxing**.
2. **2 Streamlined Workflows**:
   - **Option 1 (`join`)**: Instant lossless concatenation of input clips with resolution-adapted intro (keeps original logos). Saves to `output/output<N>_with_logo.mp4`.
   - **Option 2 (`full` - Default)**: Multi-worker parallel watermark removal across all clips scaled to system CPU/RAM, followed by resolution-adapted intro prepending and lossless YouTube concat. Saves to `output/output<N>_without_logo.mp4`.
3. **Live Multi-Clip Console Dashboard**: Real-time multi-line terminal progress bars displaying frame counts, percentages, and status for each clip concurrently.
4. **Duplicate & Conflict Protection**:
   - `output<N>_with_logo.mp4` $\rightarrow$ `output<N>_with_logo_copy1.mp4`, `output<N>_with_logo_copy2.mp4`
   - `output<N>_without_logo.mp4` $\rightarrow$ `output<N>_without_logo_copy1.mp4`, `output<N>_without_logo_copy2.mp4`
5. **YouTube-Ready**: Formatted in H.264 high profile, AAC stereo 48 kHz, and `+faststart` (moov atom placed at head for instant YouTube processing).

---

## 📁 Directory Structure

```text
Video_Joiner/
├── channel_assets/
│   ├── channel_banner.png
│   ├── channel_intro.mp4        # Intro video (automatically zoomed to fill frame)
│   └── channel_logo.png
├── input/
│   └── video1/                  # Place source clips here
│       ├── v1.mp4
│       ├── v2.mp4
│       └── ...
├── output/                      # Rendered outputs & audit reports
│   ├── output1_with_logo.mp4
│   ├── output1_without_logo.mp4
│   └── video1_report.json
├── src/
│   ├── media.mjs                # FFmpeg stream probe, smart zoom intro, and concat
│   ├── paths.mjs                # Folder detection, sorting, and with/without logo naming
│   ├── progress.mjs             # Multi-clip live terminal dashboard renderer
│   ├── system.mjs               # CPU & RAM inspection, dynamic concurrency
│   └── watermark.mjs            # GWR CLI execution & worker pool
├── index.mjs                    # Main CLI orchestrator
├── package.json
└── run.bat                      # One-click Windows runner
```

---

## 🎯 How to Use

### Method A: One-Click Windows (`run.bat`)
Double-click `run.bat` and select:
- **`[1] Join Video`**: Output saved as `output<N>_with_logo.mp4`.
- **`[2] Parallel Logo Remover + Join Video`**: Output saved as `output<N>_without_logo.mp4`.

### Method B: Command Line (PowerShell / Terminal)

```bash
# Option 2: Parallel clean + Zoom Intro + Concat (saves as output1_without_logo.mp4)
node index.mjs -i video1

# Option 1: Instant join only (saves as output1_with_logo.mp4)
node index.mjs join -i video1

# Process a specific folder
node index.mjs -i video2

# Override worker concurrency manually (e.g. 3 workers)
node index.mjs --workers 3

# Run without channel intro
node index.mjs --no-intro
```

---

## ⚙️ CLI Options Reference

| Option | Flag | Description | Output Filename |
| :--- | :--- | :--- | :--- |
| `join` | `--join-only` | Option 1: Join Video (keeps logo) | `output<N>_with_logo.mp4` |
| `full` | `fast` | Option 2: Parallel Clean + Join | `output<N>_without_logo.mp4` |
| `-i <folder>` | `--input` | Target input folder path or name | Latest `video*` |
| `-n <file>` | `--name` | Custom output file name override | User-defined |
| `--workers <N>`| `--concurrency` | Number of simultaneous workers | System-computed |
| `--intro <path>`| | Explicit channel intro file path | `channel_assets/channel_intro.mp4` |
| `--no-intro` | | Skip channel intro prepending | |
| `--fast` | | Fast temporal stabilization denoiser | Default |
| `--none` | | Ultra-fast raw reverse alpha without denoiser | |
| `--ai` | | Deep AI neural network denoiser (~15 min/clip CPU) | |
| `-b <Mbps>` | `--bitrate` | Bitrate for watermark removal in Mbps | `40` |
| `-h` | `--help` | Display help screen | |
