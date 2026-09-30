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
function getGwrCommand() {
  if (fs.existsSync(localGwrCli)) {
    return { cmd: process.execPath, args: [localGwrCli] };
  }
  return { cmd: 'npx', args: ['-y', '@pilio/gemini-watermark-remover'] };
}

/**
 * Render terminal progress bar in-place
 */
export function renderProgressBar(current, total, label = '', extra = '') {
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : current;
  const barWidth = 24;
  const filled = Math.round((barWidth * percent) / 100);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const formatted = `\r   ${label} [${bar}] ${String(percent).padStart(3)}% ${extra}`;
  process.stdout.write(formatted.padEnd(85, ' '));
}

/**
 * Remove visible Gemini logo with live progress reporting
 */
export async function removeVisibleGeminiLogo(
  input,
  output,
  bitrateMbps = 40,
  denoiseBackend = 'canvas-temporal-stabilize',
  allowLowConfidence = true,
  clipLabel = ''
) {
  const gwr = getGwrCommand();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(output, { force: true });

  const label = clipLabel || `✨ Removing Logo: ${path.basename(input)}`;
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

  renderProgressBar(0, 100, label, 'Starting engine...');

  const success = await new Promise((resolve) => {
    const child = spawn(gwr.cmd, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });

    let lastProgress = 0;

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const percentMatch = line.match(/(\d{1,3})%/);
        const frameMatch = line.match(/(\d+\/\d+\s+frames)/);
        if (percentMatch) {
          const pct = parseInt(percentMatch[1], 10);
          lastProgress = pct;
          const extra = frameMatch ? `(${frameMatch[1]})` : 'Processing frames...';
          renderProgressBar(pct, 100, label, extra);
        }
      }
    });

    child.once('error', (err) => {
      process.stdout.write(`\r   ⚠️ ${label}: Engine failed to start (${err.message}). Preserving original.\n`);
      fs.copyFileSync(input, output);
      resolve(false);
    });

    child.once('exit', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
        renderProgressBar(100, 100, label, 'Cleaned successfully!');
        process.stdout.write('\n');
        resolve(true);
      } else {
        process.stdout.write(`\r   ⚠️ ${label}: Watermark not detected or low confidence. Preserving original clip.\n`);
        fs.copyFileSync(input, output);
        resolve(false);
      }
    });
  });

  return success;
}
