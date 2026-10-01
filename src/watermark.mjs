import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localGwrCli = path.join(root, 'node_modules', '@pilio', 'gemini-watermark-remover', 'bin', 'gwr.mjs');
const localBrowsers = path.join(root, '.playwright-browsers');

/**
 * Locate GWR CLI binary or fallback to npx
 */
export function getGwrCommand() {
  if (fs.existsSync(localGwrCli)) {
    return { cmd: process.execPath, args: [localGwrCli] };
  }
  return { cmd: 'npx', args: ['-y', '@pilio/gemini-watermark-remover'] };
}

/**
 * Clean a single video file using Gemini Watermark Remover CLI
 */
export async function removeVideoWatermark(input, output, options = {}) {
  const {
    bitrateMbps = 40,
    denoiseBackend = 'canvas-temporal-stabilize',
    allowLowConfidence = true,
    onProgress = null,
  } = options;

  const gwr = getGwrCommand();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(output, { force: true });

  const args = [
    ...gwr.args,
    'remove',
    input,
    '--output', output,
    '--overwrite',
    '--video-bitrate-mbps', String(bitrateMbps),
  ];

  if (denoiseBackend) {
    args.push('--video-denoise-backend', denoiseBackend);
  }

  if (allowLowConfidence) {
    args.push('--allow-low-confidence');
  }

  const env = { ...process.env };
  if (fs.existsSync(localBrowsers)) {
    env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
  }

  if (onProgress) {
    onProgress({ percent: 0, extra: 'Starting engine...', status: 'Initializing' });
  }

  return new Promise((resolve) => {
    const child = spawn(gwr.cmd, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        // GWR format: [video] 45% 135/300 frames (AI 2, reused 133)
        const percentMatch = line.match(/\[video\]\s*(\d{1,3})%/i) || line.match(/(\d{1,3})%/);
        const frameMatch = line.match(/(\d+\/\d+\s+frames)/);
        const aiMatch = line.match(/\(AI[^\)]+\)/i);

        if (percentMatch) {
          const percent = parseInt(percentMatch[1], 10);
          const extra = [frameMatch ? frameMatch[1] : '', aiMatch ? aiMatch[0] : '']
            .filter(Boolean)
            .join(' ');
          if (onProgress) {
            onProgress({
              percent,
              extra: extra || `${percent}%`,
              status: percent >= 100 ? 'Finalizing...' : 'Cleaning frames',
            });
          }
        }
      }
    });

    child.once('error', (err) => {
      if (onProgress) {
        onProgress({ percent: 100, extra: 'Preserved', status: `Engine error: ${err.message}` });
      }
      fs.copyFileSync(input, output);
      resolve({ success: false, reason: err.message });
    });

    child.once('exit', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
        if (onProgress) {
          onProgress({ percent: 100, extra: 'Done', status: 'Cleaned successfully' });
        }
        resolve({ success: true, path: output });
      } else {
        if (onProgress) {
          onProgress({ percent: 100, extra: 'Preserved', status: 'No logo or low confidence' });
        }
        fs.copyFileSync(input, output);
        resolve({ success: false, reason: 'Watermark not detected or low confidence' });
      }
    });
  });
}

/**
 * Execute watermark removal concurrently across a list of video clips.
 */
export async function cleanClipsConcurrently(clips, cleanedOutputs, options = {}) {
  const {
    concurrency = 2,
    bitrateMbps = 40,
    denoiseBackend = 'canvas-temporal-stabilize',
    dashboard = null,
  } = options;

  let taskIndex = 0;
  const results = new Array(clips.length);

  async function worker(workerId) {
    while (taskIndex < clips.length) {
      const idx = taskIndex++;
      const src = clips[idx];
      const dst = cleanedOutputs[idx];
      const taskId = `clip_${idx + 1}`;
      const fileName = path.basename(src);

      if (dashboard) {
        dashboard.addTask(taskId, `[W${workerId}] ${fileName}`, 'Starting...');
      }

      const res = await removeVideoWatermark(src, dst, {
        bitrateMbps,
        denoiseBackend,
        allowLowConfidence: true,
        onProgress: (data) => {
          if (dashboard) {
            dashboard.update(taskId, data);
          }
        },
      });

      results[idx] = res;
      if (dashboard) {
        dashboard.complete(taskId, res.success, res.success ? 'Cleaned!' : 'Original kept');
      }
    }
  }

  const workerCount = Math.min(concurrency, clips.length);
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));

  if (dashboard) {
    dashboard.finish();
  }

  return results;
}
