# 🎬 YT Kids - Gemini Watermark Remover & Video Stitcher

An automated, 100% local Node.js tool designed to batch-remove Google Gemini watermarks from video clips and losslessly stitch them into a single final video.

Powered by the local Reverse Alpha Blending engine from [geminiwatermarkremover.io](https://geminiwatermarkremover.io/) (`@pilio/gemini-watermark-remover`) and FFmpeg.

---

## ✨ Features

- 🔍 **Automatic Latest Folder Detection**: Automatically detects and processes the newest folder in `input/` (e.g. `video1`, `video2`, `video3`).
- 🔢 **Natural Numeric Sequence Sorting**: Correctly sequences clips (`v1`, `v2`, `v3` ... `v9`, `v10`) without alphabetical sorting glitches (`v1`, `v10`, `v2`).
- 📊 **Real-Time Live Console Progress**: Shows an in-place dynamic progress bar in the terminal with live frame counts and percentages:
  ```text
  ⏳ [1/3] v1.mp4 [████████████░░░░░░░░░░░░]  50% (45/90 frames)
  ```
- ⚡ **Zero Quality Loss Concatenation**: Merges cleaned clips using FFmpeg stream copy (`-c copy`) without re-encoding, preserving exact bitstream fidelity. Automatically falls back to high-quality visually lossless re-encoding (CRF 18) only if source aspect ratios or codecs differ.
- 🧹 **Clean Output**: Leaves **only** the finished video inside `output/` (e.g., `output/output1.mp4`). All intermediate frames and temporary files are automatically cleaned up.
- 🖱️ **One-Click Windows Launcher**: Double-click `run.bat` to run directly from Windows Explorer.
- 🔒 **100% Local & Private**: No cloud uploads or external API keys needed; all ONNX inference and WebCodecs run locally on your machine.

---

## 📋 Prerequisites

1. **Node.js**: Version 18 or higher ([Download Node.js](https://nodejs.org/))
2. **FFmpeg**: Installed and available in your system `PATH` ([Download FFmpeg](https://ffmpeg.org/download.html) or `winget install Gyan.FFmpeg`)

---

## 🚀 Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/njNagaraj/YT-Kid.git
   cd YT-Kid
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Install Chromium Headless Shell (required for local ONNX processing):**
   ```bash
   npx playwright install chromium-headless-shell
   ```

---

## 📂 Project Structure

```text
YT-Kid/
├── input/
│   └── video1/             <-- Place your source clips here
│       ├── v1.mp4
│       ├── v2.mp4
│       └── v3.mp4
├── output/
│   └── output1.mp4         <-- Final merged video is saved here
├── index.mjs               <-- Core automation engine
├── package.json
├── run.bat                 <-- One-click Windows desktop launcher
└── README.md
```

---

## 🎯 How to Use

### 1. Add Your Video Clips
Create a folder inside `input/` named `video1` (or `video2`, `video3`, etc.) and place your clips inside:
```text
input/video1/v1.mp4
input/video1/v2.mp4
input/video1/v3.mp4
```

### 2. Run the Tool
Choose either method:

- **Method A (One-Click Windows):** Double-click `run.bat`.
- **Method B (Terminal):**
  ```bash
  npm start
  ```

### 3. Check the Output
The final stitched video is generated in `output/` with zero leftover temporary files:
```text
output/output1.mp4
```
*(If the input folder was `video2`, the output file will be named `output/output2.mp4`)*

---

## ⚙️ CLI Options & Advanced Usage

You can also run `index.mjs` directly with custom parameters:

```bash
node index.mjs [options]
```

| Option | Shorthand | Description | Default |
| :--- | :--- | :--- | :--- |
| `--input <path>` | `-i` | Explicitly specify input folder | Auto-detect latest `video*` |
| `--output <path>` | `-o` | Output directory for merged video | `output` |
| `--name <file>` | `-n` | Custom output filename | Auto-derived (e.g. `output1.mp4`) |
| `--bitrate <Mbps>`| `-b` | Video bitrate for watermark removal (in Mbps) | `40` |
| `--keep-temp` | | Keep temporary cleaned clips for inspection | `false` |
| `--help` | `-h` | Display help message and options | |

#### Examples:
```bash
# Process a specific folder
node index.mjs -i input/video2 -o output -n custom_final.mp4

# Run with custom watermark removal bitrate (60 Mbps)
node index.mjs -b 60
```

---

## 🛠️ How It Works Under the Hood

1. **Clip Discovery**: Scans `input/` for folders matching `video<N>`, selects the highest index, and loads clips naturally ordered (`v1` < `v2` < `v10`).
2. **Reverse Alpha Blending Engine**: Invokes `@pilio/gemini-watermark-remover` via headless Playwright Chromium. It analyzes the video frame-by-frame, locates the watermark mask via neural inference, and computes the mathematical inverse of the alpha blending to restore the original pixel colors underneath.
3. **Subprocess Stream Interception**: Intercepts `stderr` progress messages in real time to render a smooth terminal progress bar.
4. **FFmpeg Demuxer Stitching**: Generates a temporary FFmpeg concat manifest and invokes `ffmpeg -f concat -safe 0 -i manifest.txt -c copy output.mp4`. If all clips share dimensions and codecs (standard Gemini outputs), stitching is instantaneous with **zero compression quality loss**.
5. **Garbage Collection**: Deletes all temporary manifests and intermediate files.

---

## 💡 Troubleshooting & FAQ

- **"FFmpeg is not recognized as an internal or external command"**:
  Make sure FFmpeg is installed and added to your system's `PATH` environment variable. In PowerShell, test by typing `ffmpeg -version`.
- **"Watermark not detected on clip"**:
  The tool enables `--allow-low-confidence` by default. If a clip does not contain any watermark, the engine safely preserves the original clip without breaking the pipeline.
- **Can I embed thumbnails for YouTube?**:
  YouTube ignores embedded MP4 container cover tags upon upload and uses its own thumbnail selection or custom thumbnail upload in YouTube Studio.

---

## 📜 License & Credits

- Powered by the reverse alpha blending algorithm and package from [geminiwatermarkremover.io](https://geminiwatermarkremover.io/) / [@pilio/gemini-watermark-remover](https://www.npmjs.com/package/@pilio/gemini-watermark-remover).
- Video concatenation powered by [FFmpeg](https://ffmpeg.org/).
- ISC License.
