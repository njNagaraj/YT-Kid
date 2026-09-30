#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  ensureLayout,
  findInputFolder,
  findChannelIntro,
  getSortedVideoFiles,
  outputsFor,
} from './src/paths.mjs';
import {
  prepareChannelIntro,
  losslessJoin,
  probe,
  formatInfo,
  formatBytes,
} from './src/media.mjs';
import { removeVisibleGeminiLogo } from './src/watermark.mjs';

function printHelp() {
  console.log(`
🎬 YT Kids & Miniature Video Processing Pipeline
======================================================
Usage:
  node index.mjs [folder] [options]
  node index.mjs <mode> [folder] [options]

Modes:
  full (default)          Option 2: Join clips first -> remove watermark in 1 pass -> prepend intro
  join, --join-only       Option 1: Video joiner only (lossless stream-copy stitch, skip watermark removal)
  clean, --clip-by-clip   Option 3: Clean clips individually with parallel workers, then stitch
  verify                  Option 4: Probe media files and generate technical JSON report

Options:
  -i, --input <folder>    Explicit input folder path or name (e.g. video1)
  -n, --name <file>       Custom output filename (e.g. output1.mp4)
      --intro <path>      Explicit channel intro video path (default: channel_assets/channel_intro.mp4)
      --no-intro          Skip prepending channel intro to output video
      --workers <1-6>     Parallel workers for clip-by-clip mode (default: 2)
      --fast              Fast mode: canvas-temporal-stabilize denoiser (default)
      --none              Ultra-fast mode: raw reverse alpha blending without denoiser
      --ai                Deep AI neural network denoiser (~15 min/clip CPU emulation)
      --denoise <backend> Explicit denoise backend (canvas-temporal-stabilize, none, allenk-fdncnn-browser-spike)
  -b, --bitrate <Mbps>    Output bitrate for watermark removal in Mbps (default: 40)
      --keep-temp         Keep temporary files and intermediate clips
  -h, --help              Show this help message

Auto-Conflict Resolution:
  If "output1.mp4" exists in output/, automatically saves as "output1_copy1.mp4", "output1_copy2.mp4", etc.
`);
}

function parseCliArgs() {
  const rawArgs = process.argv.slice(2);
  const options = {
    mode: 'full', // 'full' (join first -> clean once), 'join', 'clean', 'verify'
    requestedFolder: null,
    outputFileName: null,
    introPath: null,
    skipIntro: false,
    workers: 2,
    denoiseBackend: 'canvas-temporal-stabilize',
    bitrateMbps: 40,
    keepTemp: false,
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg === 'join' || arg === '--join-only') {
      options.mode = 'join';
    } else if (arg === 'clean' || arg === '--clip-by-clip') {
      options.mode = 'clean';
    } else if (arg === 'verify') {
      options.mode = 'verify';
    } else if (arg === 'full') {
      options.mode = 'full';
    } else if (arg === '-i' || arg === '--input') {
      options.requestedFolder = rawArgs[++i];
    } else if (arg === '-n' || arg === '--name') {
      options.outputFileName = rawArgs[++i];
    } else if (arg === '--intro') {
      options.introPath = rawArgs[++i];
    } else if (arg === '--no-intro') {
      options.skipIntro = true;
    } else if (arg === '--workers') {
      options.workers = Math.max(1, Math.min(6, parseInt(rawArgs[++i], 10) || 2));
    } else if (arg === '--fast') {
      options.denoiseBackend = 'canvas-temporal-stabilize';
    } else if (arg === '--none') {
      options.denoiseBackend = 'none';
    } else if (arg === '--ai') {
      options.denoiseBackend = 'allenk-fdncnn-browser-spike';
    } else if (arg === '--denoise') {
      options.denoiseBackend = rawArgs[++i];
    } else if (arg === '-b' || arg === '--bitrate') {
      options.bitrateMbps = parseInt(rawArgs[++i], 10) || 40;
    } else if (arg === '--keep-temp') {
      options.keepTemp = true;
    } else if (!arg.startsWith('-') && !options.requestedFolder) {
      options.requestedFolder = arg;
    }
  }

  return options;
}

async function cleanClipsParallel(clips, cleanedDir, workersCount, bitrateMbps, denoiseBackend) {
  fs.mkdirSync(cleanedDir, { recursive: true });
  const cleanedFiles = clips.map((f, idx) => {
    const ext = path.extname(f) || '.mp4';
    const base = path.basename(f, ext);
    return path.join(cleanedDir, `clean_${base}${ext}`);
  });

  let nextIdx = 0;
  async function worker(workerId) {
    while (nextIdx < clips.length) {
      const idx = nextIdx++;
      const src = clips[idx];
      const dst = cleanedFiles[idx];
      const label = `[Worker ${workerId}] Clip ${idx + 1}/${clips.length}: ${path.basename(src)}`;
      await removeVisibleGeminiLogo(src, dst, bitrateMbps, denoiseBackend, true, label);
    }
  }

  const activeWorkers = Math.min(workersCount, clips.length);
  console.log(`\n⚡ Running ${activeWorkers} parallel worker(s) for ${clips.length} clip(s)...`);
  await Promise.all(Array.from({ length: activeWorkers }, (_, i) => worker(i + 1)));

  return cleanedFiles;
}

async function main() {
  const opts = parseCliArgs();
  ensureLayout();

  // 1. Locate folder and source clips
  const selectedFolder = findInputFolder(opts.requestedFolder);
  const videoFiles = getSortedVideoFiles(selectedFolder.fullPath);

  if (videoFiles.length === 0) {
    console.warn(`⚠️ No video files found in ${selectedFolder.name}. Supported formats: MP4, MOV, WEBM, MKV.`);
    process.exit(1);
  }

  const clipPaths = videoFiles.map((v) => v.fullPath);
  const outputs = outputsFor(selectedFolder, opts.outputFileName);

  // 2. Discover channel intro
  let channelIntroPath = null;
  if (!opts.skipIntro) {
    channelIntroPath = findChannelIntro(opts.introPath);
    if (channelIntroPath) {
      console.log(`🎬 Channel intro detected: ${channelIntroPath}`);
    }
  } else {
    console.log(`ℹ️ Channel intro skipped (--no-intro specified)`);
  }

  // 3. Print pipeline summary
  console.log('\n======================================================');
  console.log(`🚀 Video Pipeline: ${selectedFolder.name} | Mode: [${opts.mode.toUpperCase()}]`);
  console.log('======================================================');
  console.log(`📂 Input Folder:     ${selectedFolder.fullPath}`);
  console.log(`🎞️ Source Clips:     ${videoFiles.length} file(s)`);
  if (channelIntroPath) {
    console.log(`🎬 Channel Intro:    ${path.basename(channelIntroPath)} (Prepended to start)`);
  }
  videoFiles.forEach((file, idx) => {
    console.log(`   ${idx + 1}. ${file.name}`);
  });
  console.log(`📂 Output Directory: output/`);
  if (outputs.outputFileName !== outputs.desiredFileName) {
    console.log(`ℹ️ Conflict detected: "${outputs.desiredFileName}" already exists.`);
    console.log(`   Auto-renaming to:    "${outputs.outputFileName}"`);
  }
  console.log(`🎯 Target Output:    output/${outputs.outputFileName}`);
  console.log('------------------------------------------------------\n');

  fs.mkdirSync(outputs.tempDir, { recursive: true });

  let intermediateClips = [];
  let finalJoinedProbe = null;

  // 4. Execution based on mode
  if (opts.mode === 'join') {
    // ---------------------------------------------------------
    // OPTION 1: Video Joiner Only (Lossless Concat, No Watermark Removal)
    // ---------------------------------------------------------
    console.log('⚡ Processing Mode: [Option 1] Video Joiner Only (Lossless Stream Copy)');

    const queue = [];
    if (channelIntroPath) {
      console.log('🎬 Prepending channel intro to final video queue...');
      const preparedIntro = prepareChannelIntro(channelIntroPath, clipPaths[0], outputs.tempDir);
      queue.push(preparedIntro);
    }
    queue.push(...clipPaths);

    finalJoinedProbe = losslessJoin(queue, outputs.manifest, outputs.finalOutput);
  } else if (opts.mode === 'clean') {
    // ---------------------------------------------------------
    // OPTION 3: Clip-by-Clip Clean + Join
    // ---------------------------------------------------------
    console.log('⚡ Processing Mode: [Option 3] Clean Clip-by-Clip (Parallel Workers) + Concat');

    intermediateClips = await cleanClipsParallel(
      clipPaths,
      outputs.cleanedDir,
      opts.workers,
      opts.bitrateMbps,
      opts.denoiseBackend
    );

    const queue = [];
    if (channelIntroPath) {
      console.log('\n🎬 Prepending channel intro to cleaned clips...');
      const preparedIntro = prepareChannelIntro(channelIntroPath, intermediateClips[0], outputs.tempDir);
      queue.push(preparedIntro);
    }
    queue.push(...intermediateClips);

    finalJoinedProbe = losslessJoin(queue, outputs.manifest, outputs.finalOutput);
  } else if (opts.mode === 'full') {
    // ---------------------------------------------------------
    // OPTION 2: Join First -> Remove Watermark Once -> Prepend Intro (Default)
    // ---------------------------------------------------------
    console.log('⚡ Processing Mode: [Option 2] Join First -> Remove Watermark Once -> Prepend Intro');

    let rawTarget = null;
    if (clipPaths.length > 1) {
      console.log(`\n🔗 Step 1/3: Pre-joining ${clipPaths.length} clips with FFmpeg...`);
      const tempRaw = path.join(outputs.tempDir, `raw_joined_${Date.now()}.mp4`);
      losslessJoin(clipPaths, outputs.manifest, tempRaw);
      rawTarget = tempRaw;
    } else {
      console.log('\n🔗 Step 1/3: Single clip detected, proceeding to watermark removal...');
      rawTarget = clipPaths[0];
    }

    const denoiseLabel = opts.denoiseBackend === 'none'
      ? 'Ultra-Fast (Raw Reverse Alpha)'
      : opts.denoiseBackend === 'allenk-fdncnn-browser-spike'
        ? 'Deep AI FDnCNN (Slow CPU Emulation)'
        : `Fast (${opts.denoiseBackend})`;

    console.log(`\n✨ Step 2/3: Removing logo in single browser pass [Backend: ${denoiseLabel}]...`);
    const tempCleaned = path.join(outputs.tempDir, `cleaned_joined_${Date.now()}.mp4`);

    await removeVisibleGeminiLogo(
      rawTarget,
      tempCleaned,
      opts.bitrateMbps,
      opts.denoiseBackend,
      true,
      '✨ Removing Gemini Logo from Joined Video'
    );

    if (channelIntroPath) {
      console.log(`\n🎬 Step 3/3: Prepending channel intro to cleaned video...`);
      const preparedIntro = prepareChannelIntro(channelIntroPath, tempCleaned, outputs.tempDir);
      finalJoinedProbe = losslessJoin([preparedIntro, tempCleaned], outputs.manifest, outputs.finalOutput);
    } else {
      fs.copyFileSync(tempCleaned, outputs.finalOutput);
      finalJoinedProbe = probe(outputs.finalOutput);
    }
  } else if (opts.mode === 'verify') {
    console.log('🔍 Processing Mode: [Option 4] Verify Files & Generate Technical Report');
    if (fs.existsSync(outputs.finalOutput)) {
      finalJoinedProbe = probe(outputs.finalOutput);
    }
  }

  // 5. Technical Verification & JSON Report
  const sourceProbes = clipPaths.map((f) => {
    try {
      return formatInfo(probe(f));
    } catch {
      return { file: f, error: 'Could not probe file' };
    }
  });

  const report = {
    createdAt: new Date().toISOString(),
    inputFolder: selectedFolder.fullPath,
    selectedMode: opts.mode,
    outputTarget: outputs.finalOutput,
    introPrepend: channelIntroPath ? path.basename(channelIntroPath) : null,
    denoiseBackend: opts.denoiseBackend,
    workers: opts.workers,
    sources: sourceProbes,
    finalOutput: finalJoinedProbe ? formatInfo(finalJoinedProbe) : null,
  };

  fs.writeFileSync(outputs.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n📊 Technical verification report saved: output/${path.basename(outputs.report)}`);

  // 6. Temporary file cleanup
  if (!opts.keepTemp) {
    for (const dir of [outputs.tempDir, outputs.cleanedDir]) {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore cleanup error
        }
      }
    }
    if (fs.existsSync(outputs.manifest)) {
      try {
        fs.unlinkSync(outputs.manifest);
      } catch {
        // ignore
      }
    }
  }

  // 7. Summary
  console.log('\n======================================================');
  console.log('🎉 ALL TASKS COMPLETED SUCCESSFULLY!');
  console.log('======================================================');
  if (fs.existsSync(outputs.finalOutput)) {
    const stats = fs.statSync(outputs.finalOutput);
    console.log(`🎥 Final Output:   ${outputs.finalOutput}`);
    console.log(`📊 Output Size:    ${formatBytes(stats.size)}`);
    if (finalJoinedProbe?.duration) {
      console.log(`⏱️ Duration:       ${finalJoinedProbe.duration.toFixed(2)} seconds`);
    }
    if (channelIntroPath) {
      console.log(`🎬 Channel Intro:  Included at beginning (${path.basename(channelIntroPath)})`);
    }
    console.log(`✨ Clean Output:   output/ contains "${outputs.outputFileName}"`);
  }
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
