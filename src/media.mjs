import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let ffmpegPath = 'ffmpeg';
let ffprobePath = 'ffprobe';

try {
  const staticFfmpeg = await import('ffmpeg-static');
  if (staticFfmpeg?.default) ffmpegPath = staticFfmpeg.default;
} catch {
  // Use system ffmpeg
}

try {
  const staticFfprobe = await import('ffprobe-static');
  if (staticFfprobe?.default?.path) ffprobePath = staticFfprobe.default.path;
} catch {
  // Use system ffprobe
}

export function getFfmpeg() {
  return ffmpegPath;
}

export function getFfprobe() {
  return ffprobePath;
}

function run(binary, args, label) {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
}

/**
 * Probe media file for stream properties
 */
export function probe(file) {
  const raw = run(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,time_base,sample_rate,channels,channel_layout',
    '-of', 'json',
    file,
  ], `Inspect ${file}`);

  const data = JSON.parse(raw);
  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio') || null;

  if (!video) throw new Error(`No video stream found in: ${file}`);

  return {
    file,
    duration: Number(data.format?.duration || 0),
    size: Number(data.format?.size || (fs.existsSync(file) ? fs.statSync(file).size : 0)),
    bitRate: Number(data.format?.bit_rate || 0),
    video,
    audio,
  };
}

/**
 * Lightweight metadata fetch for stream matching
 */
export function getVideoMetadata(filePath) {
  try {
    const p = probe(filePath);
    return {
      width: p.video.width,
      height: p.video.height,
      r_frame_rate: p.video.r_frame_rate,
      codec: p.video.codec_name,
    };
  } catch {
    return null;
  }
}

/**
 * Compare video stream signatures
 */
export function streamSignature(info) {
  const v = info.video;
  const a = info.audio;
  return JSON.stringify({
    video: [v.codec_name, v.width, v.height, v.pix_fmt, v.r_frame_rate],
    audio: a ? [a.codec_name, a.sample_rate, a.channels] : null,
  });
}

/**
 * Assert that all files have identical video/audio stream properties
 */
export function assertLosslessCompatible(files) {
  const details = files.map((f) => (typeof f === 'string' ? probe(f) : f));
  const expected = streamSignature(details[0]);
  const bad = details.filter((item) => streamSignature(item) !== expected);
  if (bad.length) {
    throw new Error(`Clips differ in codec, dimensions, frame rate, or audio. Incompatible: ${bad.map((x) => x.file).join(', ')}`);
  }
  return details;
}

/**
 * Prepare channel intro so its resolution, aspect ratio, and fps match the target video clips.
 */
export function prepareChannelIntro(introFile, referenceClipPath, tempDir) {
  if (!referenceClipPath || !fs.existsSync(introFile)) return introFile;

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

  fs.mkdirSync(tempDir, { recursive: true });
  const normalizedIntro = path.join(tempDir, `normalized_intro_${Date.now()}.mp4`);
  console.log(`\n🎬 Adapting channel intro to match clip format (${targetMeta.width}x${targetMeta.height}, ${targetMeta.r_frame_rate} fps)...`);

  const vf = `scale=${targetMeta.width}:${targetMeta.height}:force_original_aspect_ratio=decrease,pad=${targetMeta.width}:${targetMeta.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const res = spawnSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-i', introFile,
      '-vf', vf,
      '-r', String(targetMeta.r_frame_rate),
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-ar', '48000',
      '-ac', '2',
      normalizedIntro,
    ],
    { stdio: 'inherit' }
  );

  if (res.status === 0 && fs.existsSync(normalizedIntro)) {
    return normalizedIntro;
  }

  return introFile;
}

/**
 * Concatenate multiple videos via FFmpeg concat demuxer.
 * 1. Tries 100% lossless stream copy (-c copy).
 * 2. If stream copy fails, falls back to visually lossless CRF 18 re-encode.
 */
export function losslessJoin(files, manifest, output) {
  const manifestDir = path.dirname(manifest);
  fs.mkdirSync(manifestDir, { recursive: true });

  const manifestText = files
    .map((file) => `file '${path.resolve(file).replaceAll('\\', '/').replaceAll("'", "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(manifest, `${manifestText}\n`, 'utf8');

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(output, { force: true });

  // Attempt 1: 100% Lossless Stream Copy
  const copyRes = spawnSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-f', 'concat', '-safe', '0', '-i', manifest,
      '-c', 'copy', '-movflags', '+faststart',
      output,
    ],
    { stdio: 'pipe', encoding: 'utf8' }
  );

  if (copyRes.status === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
    return probe(output);
  }

  // Attempt 2: High-Quality Fallback Re-encode
  console.log('⚠️ Stream copy concat failed (streams likely have differing timestamps or parameters). Falling back to visually lossless H.264 (CRF 18)...');
  const encodeRes = spawnSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-f', 'concat', '-safe', '0', '-i', manifest,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      output,
    ],
    { stdio: 'inherit' }
  );

  if (encodeRes.status !== 0 || !fs.existsSync(output) || fs.statSync(output).size === 0) {
    throw new Error(`FFmpeg concat failed with exit code ${encodeRes.status}`);
  }

  return probe(output);
}

/**
 * Format bytes to readable string (e.g. 12.4 MB)
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let u = -1;
  let b = bytes;
  do {
    b /= 1024;
    ++u;
  } while (Math.round(Math.abs(b) * 100) / 100 >= 1024 && u < units.length - 1);
  return `${b.toFixed(2)} ${units[u]}`;
}

export function formatInfo(info) {
  if (!info) return null;
  return {
    file: info.file,
    durationSeconds: Number(info.duration.toFixed(3)),
    sizeBytes: info.size,
    sizeHuman: formatBytes(info.size),
    bitRate: info.bitRate,
    video: {
      codec: info.video.codec_name,
      width: info.video.width,
      height: info.video.height,
      fps: info.video.r_frame_rate,
      pixelFormat: info.video.pix_fmt,
    },
    audio: info.audio ? {
      codec: info.audio.codec_name,
      sampleRate: info.audio.sample_rate,
      channels: info.audio.channels,
    } : null,
  };
}
