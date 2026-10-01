import os from 'node:os';

/**
 * Inspect system hardware specifications (CPU cores, total RAM, free RAM).
 */
export function getSystemInfo() {
  const cpus = os.cpus();
  const cpuCount = cpus.length;
  const cpuModel = cpus[0]?.model || 'Unknown CPU';
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();

  return {
    cpuCount,
    cpuModel,
    totalMemGB: totalMemBytes / (1024 * 1024 * 1024),
    freeMemGB: freeMemBytes / (1024 * 1024 * 1024),
    totalMemBytes,
    freeMemBytes,
  };
}

/**
 * Determine optimal parallel worker concurrency based on system resources.
 * Each Chromium/Playwright instance with canvas/WebGL takes ~600MB-800MB RAM.
 */
export function getOptimalConcurrency(requestedWorkers = null, totalTasks = 1) {
  const sys = getSystemInfo();

  if (requestedWorkers && Number.isInteger(requestedWorkers) && requestedWorkers > 0) {
    return Math.min(requestedWorkers, totalTasks);
  }

  // Safe RAM allowance: ~750 MB per active browser worker
  const maxByMem = Math.max(1, Math.floor(sys.freeMemGB / 0.75));
  // Leave at least 2 CPU threads free for OS and FFmpeg
  const maxByCpu = Math.max(1, sys.cpuCount - 2);

  // Reasonable safe cap: between 1 and 4 concurrent browser instances
  const optimal = Math.max(1, Math.min(maxByMem, maxByCpu, 4, totalTasks));

  return optimal;
}
