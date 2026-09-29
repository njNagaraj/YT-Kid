#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supported video formats
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']);

/**
 * Natural collator for numeric ordering (e.g., v1, v2, ..., v9, v10)
 */
const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    baseDir: process.cwd(),
    inputFolder: null,
    outputFolder: 'output',
    outputFileName: null,
    introPath: null,
    noIntro: false,
    joinOnly: false,
    clipByClip: false,
    denoiseBackend: 'canvas-temporal-stabilize',
    bitrateMbps: 40,
    keepTemp: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--input' || arg === '-i') {
      options.inputFolder = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.outputFolder = args[++i];
    } else if (arg === '--name' || arg === '-n') {
      options.outputFileName = args[++i];
    } else if (arg === '--intro') {
      options.introPath = args[++i];
    } else if (arg === '--no-intro') {
      options.noIntro = true;
    } else if (arg === '--join-only' || arg === '--skip-watermark') {
      options.joinOnly = true;
    } else if (arg === '--clip-by-clip') {
      options.clipByClip = true;
    } else if (arg === '--denoise') {
      options.denoiseBackend = args[++i];
    } else if (arg === '--fast') {
      options.denoiseBackend = 'canvas-temporal-stabilize';
    } else if (arg === '--none') {
      options.denoiseBackend = 'none';
    } else if (arg === '--ai') {
      options.denoiseBackend = 'allenk-fdncnn-browser-spike';
    } else if (arg === '--dir' || arg === '-d') {
      options.baseDir = args[++i];
    } else if (arg === '--bitrate' || arg === '-b') {
      options.bitrateMbps = Number(args[++i]) || 40;
    } else if (arg === '--keep-temp') {
      options.keepTemp = true;
    } else if (!arg.startsWith('-') && !options.inputFolder) {
      options.inputFolder = arg;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
🎬 YT Kids - Gemini Watermark Remover & Video Stitcher
======================================================
Usage:
  npm start
  node index.mjs [options]

Modes:
  --join-only             Option 1: Video Joiner only (lossless stitching, skips watermark removal)
  (default)               Option 2: Join clips first -> Remove watermark once -> Add channel intro
  --clip-by-clip          Legacy Mode: Clean each clip individually before merging

Options:
  -i, --input <folder>    Explicitly specify the video folder (default: auto-detect latest video1, video2, etc.)
  -o, --output <folder>   Output directory for merged video (default: output)
  -n, --name <file>       Custom output filename (default: output1.mp4, output2.mp4)
      --intro <path>      Explicit channel intro video path (default: channel_assets/channel_intro.mp4)
      --no-intro          Skip adding the channel intro to merged video
      --fast              Fast mode using Canvas temporal stabilization (default, seconds per clip)
      --none              Ultra-fast mode: raw reverse alpha blending without denoiser
      --denoise <backend> Denoise backend (canvas-temporal-stabilize, none, allenk-fdncnn-browser-spike)
      --ai                Enable deep AI neural network (CPU emulation: ~15 min per clip)
  -d, --dir <path>        Base directory to search for folders (default: current directory)
  -b, --bitrate <Mbps>    Output bitrate for watermark removal in Mbps (default: 40)
  -h, --help              Show this help message

Auto-detection Logic:
  Finds folders inside "input/" matching "video1", "video2", etc.
  Prepends channel intro from "channel_assets/channel_intro.mp4" if present.
  Naturally ranks by index and last-modified time, selecting the latest folder (e.g. video2).
  Reads clips inside sorted naturally: v1.mp4, v2.mp4, ..., v10.mp4.
  Outputs to output/output1.mp4 (or output2.mp4 for video2).
`);
}

/**
 * Find channel intro video file
 */
function findChannelIntro(baseDir, explicitIntroPath) {
  if (explicitIntroPath) {
    const fullPath = path.resolve(baseDir, explicitIntroPath);
    if (fs.existsSync(fullPath)) return fullPath;
    throw new Error(`Explicit channel intro file not found: ${explicitIntroPath}`);
  }

  const candidates = [
    path.join(baseDir, 'channel_assets', 'channel_intro.mp4'),
    path.join(baseDir, 'channel_assets', 'channel_into.mp4'),
    path.join(baseDir, 'channel_intro.mp4')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Probe video stream properties (width, height, fps) via ffprobe
 */
function getVideoMetadata(filePath) {
  try {
    const result = spawnSync(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate',
        '-of', 'json',
        filePath
      ],
      { encoding: 'utf-8' }
    );
    if (result.status === 0 && result.stdout) {
      const parsed = JSON.parse(result.stdout);
      if (parsed.streams && parsed.streams[0]) {
        return parsed.streams[0];
      }
    }
  } catch {
    // Ignore probing error
  }
  return null;
}

/**
 * Ensure channel intro matches reference video dimensions/fps for smooth concatenation
 */
function prepareChannelIntro(introFile, referenceClipPath, tempDir) {
  if (!referenceClipPath) return introFile;

  const introMeta = getVideoMetadata(introFile);
  const targetMeta = getVideoMetadata(referenceClipPath);

  if (!introMeta || !targetMeta) {
    return introFile;
  }

  const widthMatch = Number(introMeta.width) === Number(targetMeta.width);
  const heightMatch = Number(introMeta.height) === Number(targetMeta.height);
  const fpsMatch = String(introMeta.r_frame_rate) === String(targetMeta.r_frame_rate);

  if (widthMatch && heightMatch && fpsMatch) {
    return introFile;
  }

  const normalizedIntro = path.join(tempDir, 'normalized_channel_intro.mp4');
  console.log(`\n🎞️ Adapting channel intro to match clip format (${targetMeta.width}x${targetMeta.height}, ${targetMeta.r_frame_rate} fps)...`);

  const vf = `scale=${targetMeta.width}:${targetMeta.height}:force_original_aspect_ratio=decrease,pad=${targetMeta.width}:${targetMeta.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const res = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i', introFile,
      '-vf', vf,
      '-r', String(targetMeta.r_frame_rate),
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-ar', '48000',
      '-ac', '2',
      normalizedIntro
    ],
    { stdio: 'pipe' }
  );

  if (res.status === 0 && fs.existsSync(normalizedIntro)) {
    return normalizedIntro;
  }

  return introFile;
}

/**
 * Resolve non-conflicting output filename.
 * If output1.mp4 exists, returns output1_copy1.mp4, output1_copy2.mp4, etc.
 */
function resolveNonConflictingFilePath(targetDir, desiredFileName) {
  const parsed = path.parse(desiredFileName);
  const baseName = parsed.name;
  const ext = parsed.ext || '.mp4';

  let candidatePath = path.join(targetDir, `${baseName}${ext}`);
  if (!fs.existsSync(candidatePath)) {
    return {
      fileName: `${baseName}${ext}`,
      fullPath: candidatePath
    };
  }

  let copyIndex = 1;
  while (true) {
    const candidateName = `${baseName}_copy${copyIndex}${ext}`;
    candidatePath = path.join(targetDir, candidateName);
    if (!fs.existsSync(candidatePath)) {
      return {
        fileName: candidateName,
        fullPath: candidatePath
      };
    }
    copyIndex++;
  }
}

/**
 * Scan candidate folders in a directory matching vide_* or video_*
 */
function scanVideoFoldersInDir(targetDir) {
  if (!fs.existsSync(targetDir)) return [];
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const folders = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;

    // Matches vide_1, video_1, video_2, video_, vide_, video1, etc.
    const match = name.match(/^vide?o?[-_]*(\d+)?$/i);
    if (match) {
      const fullPath = path.join(targetDir, name);
      const stat = fs.statSync(fullPath);
      const numericIndex = match[1] !== undefined ? parseInt(match[1], 10) : 0;
      folders.push({
        name,
        fullPath,
        numericIndex,
        mtime: stat.mtimeMs
      });
    }
  }
  return folders;
}

/**
 * Find the latest folder starting with video_ or vide_
 * First checks inside 'input/' directory if it exists, otherwise checks baseDir.
 */
function findLatestVideoFolder(baseDir) {
  if (!fs.existsSync(baseDir)) {
    throw new Error(`Base directory does not exist: ${baseDir}`);
  }

  // 1. Check if an "input" folder exists and has video subfolders
  const inputDir = path.join(baseDir, 'input');
  let videoFolders = [];
  if (fs.existsSync(inputDir) && fs.statSync(inputDir).isDirectory()) {
    videoFolders = scanVideoFoldersInDir(inputDir);
    // If input directory directly contains video clips (e.g. input/v1.mp4)
    if (videoFolders.length === 0) {
      const directClips = getSortedVideoFiles(inputDir);
      if (directClips.length > 0) {
        return {
          name: 'input',
          fullPath: inputDir,
          numericIndex: 1,
          mtime: fs.statSync(inputDir).mtimeMs
        };
      }
    }
  }

  // 2. If none found in inputDir, search baseDir directly
  if (videoFolders.length === 0) {
    videoFolders = scanVideoFoldersInDir(baseDir);
  }

  if (videoFolders.length === 0) {
    return null;
  }

  // Sort by numericIndex ascending, then by mtime ascending
  videoFolders.sort((a, b) => {
    if (a.numericIndex !== b.numericIndex) {
      return a.numericIndex - b.numericIndex;
    }
    return a.mtime - b.mtime;
  });

  // Pick the last (highest index / most recent)
  return videoFolders[videoFolders.length - 1];
}

/**
 * Find all video files inside a folder and sort them naturally (v1, v2, ..., v10)
 */
function getSortedVideoFiles(folderPath) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const videoFiles = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const isVideoExt = VIDEO_EXTENSIONS.has(ext);
    const isVPattern = /^v\d+/i.test(entry.name);

    if (isVideoExt || isVPattern) {
      videoFiles.push({
        name: entry.name,
        fullPath: path.join(folderPath, entry.name),
        ext: ext || '.mp4'
      });
    }
  }

  // Natural numeric sort: v1 < v2 < v10
  videoFiles.sort((a, b) => naturalCollator.compare(a.name, b.name));

  return videoFiles;
}

/**
 * Locate the local gwr binary (from node_modules) or fall back to npx
 */
function getGwrCommand() {
  const localGwr = path.join(__dirname, 'node_modules', '@pilio', 'gemini-watermark-remover', 'bin', 'gwr.mjs');
  if (fs.existsSync(localGwr)) {
    return { cmd: process.execPath, args: [localGwr] };
  }
  return { cmd: 'npx', args: ['-y', '@pilio/gemini-watermark-remover'] };
}

/**
 * Render a live progress bar in place on the console
 */
function renderProgressBar(current, total, label = '', extra = '') {
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : current;
  const barWidth = 24;
  const filled = Math.round((barWidth * percent) / 100);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const formatted = `\r   ${label} [${bar}] ${String(percent).padStart(3)}% ${extra}`;
  process.stdout.write(formatted.padEnd(85, ' '));
}

/**
 * Remove watermark from a single video with real-time live console progress
 */
function removeWatermarkWithProgress(
  inputPath,
  outputPath,
  clipIndex,
  totalClips,
  bitrateMbps = 40,
  allowLowConfidence = true,
  denoiseBackend = 'canvas-temporal-stabilize'
) {
  return new Promise((resolve) => {
    const clipName = path.basename(inputPath);
    const label = `⏳ [${clipIndex + 1}/${totalClips}] ${clipName}`;
    const gwr = getGwrCommand();
    const args = [
      ...gwr.args,
      'remove',
      inputPath,
      '--output',
      outputPath,
      '--overwrite',
      '--video-bitrate-mbps',
      String(bitrateMbps)
    ];

    if (denoiseBackend) {
      args.push('--video-denoise-backend', denoiseBackend);
    }

    if (allowLowConfidence) {
      args.push('--allow-low-confidence');
    }

    renderProgressBar(0, 100, label, 'Starting engine...');

    const child = spawn(gwr.cmd, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderrBuffer = '';

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;

      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const percentMatch = line.match(/(\d{1,3})%/);
        const frameMatch = line.match(/(\d+\/\d+\s+frames)/);
        if (percentMatch) {
          const pct = parseInt(percentMatch[1], 10);
          const extra = frameMatch ? `(${frameMatch[1]})` : 'Processing...';
          renderProgressBar(pct, 100, label, extra);
        }
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        const doneLabel = `✅ [${clipIndex + 1}/${totalClips}] ${clipName}`;
        renderProgressBar(100, 100, doneLabel, 'Cleaned!');
        process.stdout.write('\n');
        resolve(true);
      } else {
        const warnLabel = `⚠️ [${clipIndex + 1}/${totalClips}] ${clipName}`;
        process.stdout.write(`\r   ${warnLabel} Watermark not detected, preserving clip.\n`);
        fs.copyFileSync(inputPath, outputPath);
        resolve(false);
      }
    });

    child.on('error', (err) => {
      process.stdout.write(`\r   ⚠️ [${clipIndex + 1}/${totalClips}] ${clipName} Error: ${err.message}, preserving clip.\n`);
      fs.copyFileSync(inputPath, outputPath);
      resolve(false);
    });
  });
}

/**
 * Concatenate videos using FFmpeg
 * 1. Tries lossless stream copy (-c copy)
 * 2. If codecs/resolutions differ, automatically falls back to visually lossless H.264 (-crf 18)
 */
function concatVideos(cleanedFiles, finalOutputFile) {
  const outputDir = path.dirname(finalOutputFile);
  const manifestPath = path.join(outputDir, `concat_manifest_${Date.now()}.txt`);

  // Write FFmpeg concat manifest file
  // FFmpeg requires single quotes and escaped inner single quotes
  const manifestContent = cleanedFiles
    .map((filePath) => {
      const normalized = path.resolve(filePath).replace(/\\/g, '/');
      const escaped = normalized.replace(/'/g, "'\\''");
      return `file '${escaped}'`;
    })
    .join('\n');

  fs.writeFileSync(manifestPath, manifestContent, 'utf-8');

  console.log(`\n🔗 Concatenating ${cleanedFiles.length} clips with FFmpeg...`);
  renderProgressBar(20, 100, '⏳ Stitching', 'Merging video bitstreams...');

  try {
    // Attempt 1: 100% Lossless Stream Copy (-c copy)
    const copyResult = spawnSync(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', manifestPath, '-c', 'copy', finalOutputFile],
      { stdio: 'pipe', encoding: 'utf-8' }
    );

    if (copyResult.status === 0) {
      renderProgressBar(100, 100, '✅ Lossless Stitched', '(0 quality loss stream copy)');
      process.stdout.write('\n');
      return;
    }

    // Attempt 2: If stream-copy failed (e.g. mismatched aspect ratios or codecs), fallback to high-quality re-encode
    renderProgressBar(50, 100, '🔄 Encoding', 'Re-encoding clips with CRF 18...');
    const encodeResult = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        manifestPath,
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-preset',
        'fast',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        finalOutputFile
      ],
      { stdio: 'inherit' }
    );

    if (encodeResult.status !== 0) {
      throw new Error(`FFmpeg concatenation failed with exit code ${encodeResult.status}`);
    }

    renderProgressBar(100, 100, '✅ Concatenation Complete', '');
    process.stdout.write('\n');
  } finally {
    // Clean up temporary manifest
    if (fs.existsSync(manifestPath)) {
      try {
        fs.unlinkSync(manifestPath);
      } catch {
        // ignore cleanup error
      }
    }
  }
}

/**
 * Format bytes to readable string (e.g. 12.4 MB)
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Main application entry point
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  console.log('\n======================================================');
  console.log('🎬 YT Kids - Gemini Watermark Remover & Video Stitcher');
  console.log('======================================================\n');

  // 1. Determine input folder
  let selectedFolder = null;
  if (options.inputFolder) {
    let fullPath = path.resolve(options.baseDir, options.inputFolder);
    if (!fs.existsSync(fullPath)) {
      // Check inside input/ directory as shorthand (e.g. -i video2)
      const insideInput = path.resolve(options.baseDir, 'input', options.inputFolder);
      if (fs.existsSync(insideInput)) {
        fullPath = insideInput;
      } else {
        console.error(`❌ Specified input folder not found: "${options.inputFolder}" (checked "${fullPath}" and "${insideInput}")`);
        process.exit(1);
      }
    }
    const folderName = path.basename(fullPath);
    const match = folderName.match(/^vide?o?[-_]*(\d+)?$/i);
    const numericIndex = match && match[1] !== undefined ? parseInt(match[1], 10) : 1;
    selectedFolder = {
      name: folderName,
      fullPath,
      numericIndex
    };
    console.log(`📁 Target folder explicitly provided: ${selectedFolder.name} (Output -> output${numericIndex}.mp4)`);
  } else {
    selectedFolder = findLatestVideoFolder(options.baseDir);
    if (!selectedFolder) {
      console.error(`❌ No video folders found in "${path.join(options.baseDir, 'input')}" or "${options.baseDir}"`);
      console.error('   Please place your clips inside "input/video1/" (e.g. v1.mp4, v2.mp4, v3.mp4).');
      process.exit(1);
    }
    console.log(`🔍 Auto-detected latest folder: ${selectedFolder.name} (${selectedFolder.fullPath})`);
  }

  // 1b. Check for channel intro video
  let channelIntroPath = null;
  if (!options.noIntro) {
    channelIntroPath = findChannelIntro(options.baseDir, options.introPath);
    if (channelIntroPath) {
      const relIntro = path.relative(options.baseDir, channelIntroPath);
      console.log(`🎬 Channel intro detected: ${relIntro} (will be prepended)`);
    }
  } else {
    console.log(`ℹ️ Channel intro skipped (--no-intro specified)`);
  }

  // 2. Discover and sort video clips inside the folder
  const videoFiles = getSortedVideoFiles(selectedFolder.fullPath);
  if (videoFiles.length === 0) {
    console.warn(`⚠️ No video files found in ${selectedFolder.name}. Supported formats: ${Array.from(VIDEO_EXTENSIONS).join(', ')}`);
    process.exit(0);
  }

  console.log(`\n🎞️ Found ${videoFiles.length} video clip(s) in sequence:`);
  let displayIndex = 1;
  if (channelIntroPath) {
    console.log(`   ${displayIndex++}. [Channel Intro] ${path.basename(channelIntroPath)}`);
  }
  videoFiles.forEach((file) => {
    console.log(`   ${displayIndex++}. ${file.name}`);
  });

  // 3. Prepare output directory (ONLY the final output video will be kept here)
  const outDir = path.resolve(options.baseDir, options.outputFolder);
  fs.mkdirSync(outDir, { recursive: true });

  // Use a temporary folder for intermediate cleaned clips
  const tempCleanDir = path.join(options.baseDir, `.temp_clean_${Date.now()}`);
  fs.mkdirSync(tempCleanDir, { recursive: true });

  // Determine desired output file name:
  // Strictly without underscore: e.g. "video1" -> "output1.mp4", "video2" -> "output2.mp4"
  const desiredFileName =
    options.outputFileName ||
    `output${selectedFolder.numericIndex || 1}.mp4`;

  // Auto-resolve naming conflicts: if output1.mp4 exists, use output1_copy1.mp4, output1_copy2.mp4, etc.
  const resolved = resolveNonConflictingFilePath(outDir, desiredFileName);
  const outputFileName = resolved.fileName;
  const finalMergedOutput = resolved.fullPath;

  console.log(`\n📂 Output folder: ${options.outputFolder}/`);
  if (outputFileName !== desiredFileName) {
    console.log(`ℹ️ Conflict detected: "${desiredFileName}" already exists.`);
    console.log(`   Auto-renaming to:    "${outputFileName}"`);
  }
  console.log(`🎯 Final video target: ${path.join(options.outputFolder, outputFileName)}`);

  // 4. Processing based on chosen mode
  if (options.joinOnly) {
    // ---------------------------------------------------------
    // OPTION 1: Video Joiner Only (Lossless Concat, No Watermark Removal)
    // ---------------------------------------------------------
    console.log('\n🚀 Processing Mode: [1] Video Joiner Only (Lossless Stitching, No Watermark Removal)');

    const clipsToMerge = [];
    if (channelIntroPath) {
      console.log('🎬 Prepending channel intro to final video queue...');
      const preparedIntro = prepareChannelIntro(channelIntroPath, videoFiles[0].fullPath, tempCleanDir);
      clipsToMerge.push(preparedIntro);
    }
    clipsToMerge.push(...videoFiles.map((f) => f.fullPath));

    concatVideos(clipsToMerge, finalMergedOutput);
  } else if (options.clipByClip) {
    // ---------------------------------------------------------
    // LEGACY: Clean clips individually, then join
    // ---------------------------------------------------------
    console.log('\n🚀 Processing Mode: Video Joiner + Watermark Remover (Clip-by-Clip Pass)');
    const denoiseDesc = options.denoiseBackend === 'allenk-fdncnn-browser-spike'
      ? 'Deep AI FDnCNN (Slow CPU Emulation, ~15 min/clip)'
      : options.denoiseBackend === 'none'
        ? 'Ultra-Fast (Raw Reverse Alpha, No Denoiser)'
        : `Fast (${options.denoiseBackend})`;
    console.log(`✨ Removing watermarks [Engine: geminiwatermarkremover.io | Mode: ${denoiseDesc}]...`);
    const cleanedFiles = [];

    for (let i = 0; i < videoFiles.length; i++) {
      const file = videoFiles[i];
      const outExt = file.ext && file.ext.startsWith('.') ? file.ext : '.mp4';
      const baseNameWithoutExt = file.ext ? path.basename(file.name, file.ext) : file.name;
      const cleanOutput = path.join(tempCleanDir, `clean_${baseNameWithoutExt}${outExt}`);
      cleanedFiles.push(cleanOutput);

      await removeWatermarkWithProgress(
        file.fullPath,
        cleanOutput,
        i,
        videoFiles.length,
        options.bitrateMbps,
        true,
        options.denoiseBackend
      );
    }

    const clipsToMerge = [];
    if (channelIntroPath) {
      const preparedIntro = prepareChannelIntro(channelIntroPath, cleanedFiles[0], tempCleanDir);
      clipsToMerge.push(preparedIntro);
    }
    clipsToMerge.push(...cleanedFiles);

    concatVideos(clipsToMerge, finalMergedOutput);
  } else {
    // ---------------------------------------------------------
    // OPTION 2: Join first -> Remove watermark once -> Add channel intro
    // ---------------------------------------------------------
    console.log('\n🚀 Processing Mode: [2] Video Joiner + Watermark Remover (Join First -> Remove Watermark -> Prepend Intro)');

    let rawTargetToClean = null;
    if (videoFiles.length > 1) {
      console.log(`\n🔗 Step 1/3: Pre-joining ${videoFiles.length} source clips with FFmpeg...`);
      const tempRawJoined = path.join(tempCleanDir, `raw_joined_${Date.now()}.mp4`);
      concatVideos(videoFiles.map((f) => f.fullPath), tempRawJoined);
      rawTargetToClean = tempRawJoined;
    } else {
      console.log('\n🔗 Step 1/3: Single clip detected, proceeding directly to watermark removal...');
      rawTargetToClean = videoFiles[0].fullPath;
    }

    // Step 2: Remove watermark from the joined video in one single browser pass
    const tempCleanedJoined = path.join(tempCleanDir, `cleaned_joined_${Date.now()}.mp4`);
    const denoiseDesc = options.denoiseBackend === 'allenk-fdncnn-browser-spike'
      ? 'Deep AI FDnCNN (Slow CPU Emulation, ~15 min/clip)'
      : options.denoiseBackend === 'none'
        ? 'Ultra-Fast (Raw Reverse Alpha, No Denoiser)'
        : `Fast (${options.denoiseBackend})`;
    console.log(`\n✨ Step 2/3: Removing watermarks from joined video [Engine: geminiwatermarkremover.io | Mode: ${denoiseDesc}]...`);

    await removeWatermarkWithProgress(
      rawTargetToClean,
      tempCleanedJoined,
      0,
      1,
      options.bitrateMbps,
      true,
      options.denoiseBackend
    );

    // Step 3: Add channel intro if present
    if (channelIntroPath) {
      console.log(`\n🎬 Step 3/3: Prepending channel intro to cleaned video...`);
      const preparedIntro = prepareChannelIntro(channelIntroPath, tempCleanedJoined, tempCleanDir);
      concatVideos([preparedIntro, tempCleanedJoined], finalMergedOutput);
    } else {
      fs.copyFileSync(tempCleanedJoined, finalMergedOutput);
    }
  }

  // 6. Clean up temporary files so ONLY the final video exists in the output folder
  if (!options.keepTemp) {
    try {
      fs.rmSync(tempCleanDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }

  // 7. Summary report
  console.log('\n======================================================');
  console.log('🎉 ALL TASKS COMPLETED SUCCESSFULLY!');
  console.log('======================================================');
  if (fs.existsSync(finalMergedOutput)) {
    const stats = fs.statSync(finalMergedOutput);
    console.log(`🎥 Final Merged Video: ${finalMergedOutput}`);
    console.log(`📊 File Size:          ${formatBytes(stats.size)}`);
    const modeLabel = options.joinOnly
      ? 'Option 1: Video Joiner Only (Lossless Stitching)'
      : options.clipByClip
        ? 'Legacy: Clip-by-Clip Removal + Merge'
        : 'Option 2: Join First -> Remove Watermark Once -> Prepend Intro';
    console.log(`⚙️ Executed Mode:      ${modeLabel}`);
    if (channelIntroPath) {
      console.log(`🎬 Channel Intro:      Included at start (${path.basename(channelIntroPath)})`);
    }
    console.log(`✨ Clean Output:       ${options.outputFolder}/ contains ONLY "${outputFileName}"`);
  }
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
