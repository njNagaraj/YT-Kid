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
import { cleanClipsConcurrently } from './src/watermark.mjs';
import { MultiProgressBar } from './src/progress.mjs';
import { getSystemInfo, getOptimalConcurrency } from './src/system.mjs';

function printHelp() {
  console.log(`
🎬 YT Video Pipeline - Joiner & Parallel Logo Cleaner
================================================================
Usage:
  node index.mjs [folder] [options]
  node index.mjs <mode> [folder] [options]

Modes:
  [1] join, --join-only     Option 1: Join Video (Keeps logo)
                            Outputs to: output<N>_with_logo.mp4
                            Instant lossless stream-copy concat with resolution-adapted intro.

  [2] full, fast (default)  Option 2: Parallel Logo Remover + Join Video (Removes logo)
                            Outputs to: output<N>_without_logo.mp4
                            System-scaled parallel watermark removal across all clips,
                            resolution-adapted channel intro, and YouTube-ready concat.

Options:
  -i, --input <folder>      Explicit input folder path or name (e.g. video1)
  -n, --name <file>         Custom output filename override
      --workers <N>         Override worker concurrency (auto-computed by default based on RAM/CPU)
      --intro <path>        Explicit channel intro video path (default: channel_assets/channel_intro.mp4)
      --no-intro            Skip prepending channel intro to output video
      --fast                Fast temporal stabilization denoiser (default)
      --none                Ultra-fast mode: raw reverse alpha without neural denoiser
      --ai                  Deep AI neural network denoiser (~15 min/clip CPU)
      --denoise <backend>   Explicit denoise backend (canvas-temporal-stabilize, none, allenk-fdncnn-browser-spike)
  -b, --bitrate <Mbps>      Output bitrate for watermark removal in Mbps (default: 40)
      --keep-temp           Keep temporary files and intermediate clips
  -h, --help                Show this help message

Auto-Conflict / Duplicate Protection:
  If "output1_with_logo.mp4" exists -> saves as "output1_with_logo_copy1.mp4", "output1_with_logo_copy2.mp4", etc.
  If "output1_without_logo.mp4" exists -> saves as "output1_without_logo_copy1.mp4", "output1_without_logo_copy2.mp4", etc.
`);
}

function parseCliArgs() {
  const rawArgs = process.argv.slice(2);
  const options = {
    mode: 'full', // 'full' (without logo) or 'join' (with logo)
    requestedFolder: null,
    outputFileName: null,
    introPath: null,
    skipIntro: false,
    workers: null,
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
    } else if (arg === 'verify') {
      options.mode = 'verify';
    } else if (arg === 'full' || arg === 'fast') {
      options.mode = 'full';
    } else if (arg === '-i' || arg === '--input') {
      options.requestedFolder = rawArgs[++i];
    } else if (arg === '-n' || arg === '--name') {
      options.outputFileName = rawArgs[++i];
    } else if (arg === '--intro') {
      options.introPath = rawArgs[++i];
    } else if (arg === '--no-intro') {
      options.skipIntro = true;
    } else if (arg === '--workers' || arg === '--concurrency') {
      options.workers = parseInt(rawArgs[++i], 10);
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

async function main() {
  const opts = parseCliArgs();
  ensureLayout();

  // 1. Inspect System Hardware & Concurrency
  const sysInfo = getSystemInfo();

  // 2. Discover Input Clips
  const selectedFolder = findInputFolder(opts.requestedFolder);
  const videoFiles = getSortedVideoFiles(selectedFolder.fullPath);

  if (videoFiles.length === 0) {
    console.warn(`⚠️ No video files found in ${selectedFolder.name}. Supported formats: MP4, MOV, WEBM, MKV.`);
    process.exit(1);
  }

  const concurrency = getOptimalConcurrency(opts.workers, videoFiles.length);
  const clipPaths = videoFiles.map((v) => v.fullPath);
  
  // Pass mode to outputsFor to determine with_logo vs without_logo
  const outputs = outputsFor(selectedFolder, opts.mode, opts.outputFileName);

  // 3. Discover Channel Intro
  let channelIntroPath = null;
  if (!opts.skipIntro) {
    channelIntroPath = findChannelIntro(opts.introPath);
  }

  // 4. Print Pipeline Banner
  const modeTitle = opts.mode === 'join'
    ? 'OPTION 1: Join Video (With Logo)'
    : opts.mode === 'verify'
      ? 'OPTION 3: Verify & Audit'
      : 'OPTION 2: Parallel Logo Remover + Join Video (Without Logo)';

  console.log('\n======================================================');
  console.log(`🚀 YT Video Pipeline | ${modeTitle}`);
  console.log('======================================================');
  console.log(`💻 System Info:      ${sysInfo.cpuCount} CPU cores | ${sysInfo.freeMemGB.toFixed(2)} GB free RAM of ${sysInfo.totalMemGB.toFixed(1)} GB`);
  if (opts.mode === 'full') {
    console.log(`⚡ Concurrency:      ${concurrency} concurrent worker(s)`);
  }
  console.log(`📂 Input Folder:     ${selectedFolder.fullPath}`);
  console.log(`🎞️ Source Clips:     ${videoFiles.length} file(s) in sequence:`);
  videoFiles.forEach((file, idx) => {
    console.log(`   ${idx + 1}. ${file.name}`);
  });
  if (channelIntroPath) {
    console.log(`🎬 Channel Intro:    ${path.basename(channelIntroPath)} (Smart zoom-to-fill enabled)`);
  } else {
    console.log(`ℹ️ Channel Intro:    None`);
  }
  console.log(`📂 Output Target:    output/${outputs.outputFileName}`);
  if (outputs.outputFileName !== outputs.desiredFileName) {
    console.log(`ℹ️ Duplicate conflict detected: "${outputs.desiredFileName}" already exists.`);
    console.log(`   Auto-renamed to: "${outputs.outputFileName}"`);
  }
  console.log('------------------------------------------------------\n');

  fs.mkdirSync(outputs.tempDir, { recursive: true });
  fs.mkdirSync(outputs.cleanedDir, { recursive: true });

  let finalProbe = null;

  // 5. Execution
  if (opts.mode === 'join') {
    // ---------------------------------------------------------
    // OPTION 1: Join Video (With Logo)
    // ---------------------------------------------------------
    console.log('⚡ Processing Mode: [Option 1] Join Video (Keeping Logo)\n');
    const queue = [];
    if (channelIntroPath) {
      const adaptedIntro = prepareChannelIntro(channelIntroPath, clipPaths[0], outputs.tempDir);
      queue.push(adaptedIntro);
    }
    queue.push(...clipPaths);

    finalProbe = losslessJoin(queue, outputs.manifest, outputs.finalOutput);
  } else if (opts.mode === 'full') {
    // ---------------------------------------------------------
    // OPTION 2: Parallel Logo Remover + Join Video (Without Logo)
    // ---------------------------------------------------------
    console.log(`✨ Step 1/3: Removing watermarks across ${videoFiles.length} clips with ${concurrency} parallel worker(s)...\n`);

    const cleanedOutputs = clipPaths.map((f, idx) => {
      const ext = path.extname(f) || '.mp4';
      const base = path.basename(f, ext);
      return path.join(outputs.cleanedDir, `clean_${base}${ext}`);
    });

    const dashboard = new MultiProgressBar(clipPaths.length);

    await cleanClipsConcurrently(clipPaths, cleanedOutputs, {
      concurrency,
      bitrateMbps: opts.bitrateMbps,
      denoiseBackend: opts.denoiseBackend,
      dashboard,
    });

    // Step 2: Prepare Channel Intro with Zoom-to-Fill
    const queue = [];
    if (channelIntroPath) {
      console.log('\n🎬 Step 2/3: Adapting channel intro (Smart Zoom & Crop to match video format)...');
      const adaptedIntro = prepareChannelIntro(channelIntroPath, cleanedOutputs[0], outputs.tempDir);
      queue.push(adaptedIntro);
    } else {
      console.log('\n🎬 Step 2/3: Skipping channel intro...');
    }

    // Step 3: Lossless Concat
    console.log(`\n🔗 Step 3/3: Joining all ${queue.length + cleanedOutputs.length} clips for YouTube...`);
    queue.push(...cleanedOutputs);

    finalProbe = losslessJoin(queue, outputs.manifest, outputs.finalOutput);
  } else if (opts.mode === 'verify') {
    console.log('🔍 Processing Mode: Verify Files & Generate Technical Report');
    if (fs.existsSync(outputs.finalOutput)) {
      finalProbe = probe(outputs.finalOutput);
    }
  }

  // 6. Generate Verification Report
  const sourceProbes = clipPaths.map((f) => {
    try {
      return formatInfo(probe(f));
    } catch {
      return { file: f, error: 'Could not probe file' };
    }
  });

  const report = {
    createdAt: new Date().toISOString(),
    system: {
      cpuCount: sysInfo.cpuCount,
      freeMemGB: sysInfo.freeMemGB,
      concurrency,
    },
    inputFolder: selectedFolder.fullPath,
    selectedMode: opts.mode,
    outputTarget: outputs.finalOutput,
    introPrepend: channelIntroPath ? path.basename(channelIntroPath) : null,
    denoiseBackend: opts.denoiseBackend,
    sources: sourceProbes,
    finalOutput: finalProbe ? formatInfo(finalProbe) : null,
  };

  fs.writeFileSync(outputs.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n📊 Technical verification report saved: output/${path.basename(outputs.report)}`);

  // 7. Cleanup Temporary Files
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

  // 8. Final Report
  console.log('\n======================================================');
  console.log('🎉 ALL TASKS COMPLETED SUCCESSFULLY!');
  console.log('======================================================');
  if (fs.existsSync(outputs.finalOutput)) {
    const stats = fs.statSync(outputs.finalOutput);
    console.log(`🎥 Final Video:    ${outputs.finalOutput}`);
    console.log(`🏷️ Output Type:    ${opts.mode === 'join' ? 'With Logo (output<N>_with_logo.mp4)' : 'Without Logo (output<N>_without_logo.mp4)'}`);
    console.log(`📊 File Size:      ${formatBytes(stats.size)}`);
    if (finalProbe?.duration) {
      console.log(`⏱️ Duration:       ${finalProbe.duration.toFixed(2)} seconds`);
    }
    if (finalProbe?.video) {
      console.log(`📺 Resolution:     ${finalProbe.video.width}x${finalProbe.video.height} (${finalProbe.video.r_frame_rate} fps)`);
    }
    if (channelIntroPath) {
      console.log(`🎬 Channel Intro:  Zoom-corrected and included at beginning`);
    }
    console.log(`🚀 YouTube Ready:  H.264 / AAC stereo / +faststart enabled`);
    console.log(`✨ Clean Output:   output/ contains "${outputs.outputFileName}"`);
  }
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
