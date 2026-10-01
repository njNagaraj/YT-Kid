import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const inputRoot = path.join(root, 'input');
export const outputRoot = path.join(root, 'output');
export const tempRoot = path.join(root, 'temp');
export const channelAssetsRoot = path.join(root, 'channel_assets');

// Supported video formats
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']);

// Natural collator for numeric ordering (e.g. v1, v2, ..., v9, v10)
export const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function ensureLayout() {
  for (const dir of [inputRoot, outputRoot, tempRoot]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Find channel intro video file if available.
 */
export function findChannelIntro(explicitIntroPath) {
  if (explicitIntroPath) {
    const fullPath = path.isAbsolute(explicitIntroPath)
      ? explicitIntroPath
      : path.resolve(root, explicitIntroPath);
    if (fs.existsSync(fullPath)) return fullPath;
    throw new Error(`Explicit channel intro file not found: ${explicitIntroPath}`);
  }

  const candidates = [
    path.join(channelAssetsRoot, 'channel_intro.mp4'),
    path.join(channelAssetsRoot, 'channel_into.mp4'),
    path.join(root, 'channel_intro.mp4'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Scan candidate folders in a directory matching vide_* or video_*
 */
function scanVideoFolders(targetDir) {
  if (!fs.existsSync(targetDir)) return [];
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const folders = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const match = name.match(/^vide?o?[-_]*(\d+)?$/i);
    if (match) {
      const fullPath = path.join(targetDir, name);
      const stat = fs.statSync(fullPath);
      const numericIndex = match[1] !== undefined ? parseInt(match[1], 10) : 0;
      folders.push({
        name,
        fullPath,
        numericIndex,
        mtime: stat.mtimeMs,
      });
    }
  }
  return folders;
}

/**
 * Find requested or latest input folder.
 */
export function findInputFolder(requested) {
  if (requested) {
    const directPath = path.isAbsolute(requested)
      ? requested
      : path.resolve(root, requested);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
      const baseName = path.basename(directPath);
      const match = baseName.match(/(\d+)/);
      return {
        name: baseName,
        fullPath: directPath,
        numericIndex: match ? parseInt(match[1], 10) : 1,
      };
    }

    const inInputPath = path.join(inputRoot, requested);
    if (fs.existsSync(inInputPath) && fs.statSync(inInputPath).isDirectory()) {
      const baseName = path.basename(inInputPath);
      const match = baseName.match(/(\d+)/);
      return {
        name: baseName,
        fullPath: inInputPath,
        numericIndex: match ? parseInt(match[1], 10) : 1,
      };
    }

    throw new Error(`Invalid or missing input folder: ${requested}`);
  }

  // Auto-detection: scan input/ first
  let candidates = scanVideoFolders(inputRoot);

  if (candidates.length === 0) {
    // Check if input/ itself has clips
    const directClips = getSortedVideoFiles(inputRoot);
    if (directClips.length > 0) {
      return {
        name: 'input',
        fullPath: inputRoot,
        numericIndex: 1,
      };
    }
    // Scan root
    candidates = scanVideoFolders(root);
  }

  if (candidates.length === 0) {
    throw new Error(`No video folders found in ${inputRoot} or ${root}`);
  }

  // Sort by numericIndex ascending, then by mtime ascending (last is latest)
  candidates.sort((a, b) => {
    if (a.numericIndex !== b.numericIndex) {
      return a.numericIndex - b.numericIndex;
    }
    return a.mtime - b.mtime;
  });

  const latest = candidates[candidates.length - 1];
  return {
    name: latest.name,
    fullPath: latest.fullPath,
    numericIndex: latest.numericIndex || 1,
  };
}

/**
 * Find all video files inside a folder and sort them naturally (v1, v2, ..., v10).
 */
export function getSortedVideoFiles(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
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
        ext: ext || '.mp4',
      });
    }
  }

  videoFiles.sort((a, b) => naturalCollator.compare(a.name, b.name));
  return videoFiles;
}

/**
 * Backward compatibility alias for getSortedVideoFiles
 */
export function getSixClips(folder) {
  const folderPath = typeof folder === 'string' ? folder : folder.fullPath;
  const clips = getSortedVideoFiles(folderPath);
  if (clips.length === 0) {
    throw new Error(`No video files found in ${folderPath}. Supported formats: ${Array.from(VIDEO_EXTENSIONS).join(', ')}`);
  }
  return clips.map((f) => f.fullPath);
}

/**
 * Resolve non-conflicting output filename.
 * If target exists, appends _copy1, _copy2, etc. before the extension:
 * output1_with_logo.mp4 -> output1_with_logo_copy1.mp4, output1_with_logo_copy2.mp4
 * output1_without_logo.mp4 -> output1_without_logo_copy1.mp4, output1_without_logo_copy2.mp4
 */
export function resolveNonConflictingFilePath(targetDir, desiredFileName) {
  const parsed = path.parse(desiredFileName);
  const baseName = parsed.name;
  const ext = parsed.ext || '.mp4';

  let candidatePath = path.join(targetDir, `${baseName}${ext}`);
  if (!fs.existsSync(candidatePath)) {
    return {
      fileName: `${baseName}${ext}`,
      fullPath: candidatePath,
    };
  }

  let copyIndex = 1;
  while (true) {
    const candidateName = `${baseName}_copy${copyIndex}${ext}`;
    candidatePath = path.join(targetDir, candidateName);
    if (!fs.existsSync(candidatePath)) {
      return {
        fileName: candidateName,
        fullPath: candidatePath,
      };
    }
    copyIndex++;
  }
}

/**
 * Generate output paths for a selected folder based on workflow mode.
 * - Mode 'join': desired name is output<N>_with_logo.mp4
 * - Mode 'full' / 'clean': desired name is output<N>_without_logo.mp4
 */
export function outputsFor(folderInfo, mode = 'full', customFileName = null) {
  const folderName = typeof folderInfo === 'string' ? path.basename(folderInfo) : folderInfo.name;
  const numericIndex = typeof folderInfo === 'object' && folderInfo.numericIndex !== undefined
    ? folderInfo.numericIndex
    : (folderName.match(/\d+/) ? Number(folderName.match(/\d+/)[0]) : 1);

  let desiredFileName = customFileName;
  if (!desiredFileName) {
    if (mode === 'join') {
      desiredFileName = `output${numericIndex}_with_logo.mp4`;
    } else if (mode === 'full' || mode === 'clean') {
      desiredFileName = `output${numericIndex}_without_logo.mp4`;
    } else {
      desiredFileName = `output${numericIndex}.mp4`;
    }
  }

  const resolved = resolveNonConflictingFilePath(outputRoot, desiredFileName);
  const timestamp = Date.now();

  return {
    desiredFileName,
    outputFileName: resolved.fileName,
    finalOutput: resolved.fullPath,
    joined: path.join(outputRoot, `${folderName}_joined_master.mp4`),
    clean: resolved.fullPath,
    cleanedDir: path.join(tempRoot, `${folderName}_cleaned_${timestamp}`),
    tempDir: path.join(tempRoot, `.temp_${folderName}_${timestamp}`),
    report: path.join(outputRoot, `${folderName}_report.json`),
    manifest: path.join(tempRoot, `${folderName}_concat_${timestamp}.txt`),
  };
}
