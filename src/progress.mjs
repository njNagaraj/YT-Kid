import readline from 'node:readline';

/**
 * Multi-task live console progress dashboard.
 * Renders multiple progress bars simultaneously in the terminal without flickering.
 */
export class MultiProgressBar {
  constructor(totalTasks = 0) {
    this.tasks = new Map();
    this.totalTasks = totalTasks;
    this.renderedLines = 0;
    this.isTTY = Boolean(process.stdout.isTTY);
    this.renderInterval = null;
    this.isDirty = false;
  }

  addTask(id, label, initialStatus = 'Queued') {
    this.tasks.set(id, {
      id,
      label,
      percent: 0,
      extra: '',
      status: initialStatus,
      completed: false,
    });
    this.isDirty = true;
    this.render();
  }

  update(id, data = {}) {
    const task = this.tasks.get(id);
    if (!task) return;

    if (data.percent !== undefined) task.percent = Math.max(0, Math.min(100, Math.round(data.percent)));
    if (data.extra !== undefined) task.extra = data.extra;
    if (data.status !== undefined) task.status = data.status;

    this.isDirty = true;
    this.render();
  }

  complete(id, success = true, finalMessage = '') {
    const task = this.tasks.get(id);
    if (!task) return;

    task.percent = 100;
    task.completed = true;
    task.status = success ? (finalMessage || 'Cleaned!') : (finalMessage || 'Preserved original');
    this.isDirty = true;
    this.render();
  }

  render() {
    if (!this.isDirty) return;
    this.isDirty = false;

    const taskList = Array.from(this.tasks.values());
    if (taskList.length === 0) return;

    const barWidth = 20;
    const lines = [];

    for (const task of taskList) {
      const filled = Math.round((barWidth * task.percent) / 100);
      const empty = barWidth - filled;
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
      const pctStr = `${String(task.percent).padStart(3)}%`;

      let icon = '⏳';
      if (task.completed) {
        icon = task.status.toLowerCase().includes('clean') ? '✅' : '⚠️';
      } else if (task.percent > 0) {
        icon = '✨';
      }

      const line = ` ${icon} ${task.label.padEnd(28)} [${bar}] ${pctStr} ${task.extra.padEnd(20)} ${task.status}`;
      lines.push(line);
    }

    if (this.isTTY) {
      // Clear previously rendered lines and move cursor up
      if (this.renderedLines > 0) {
        readline.cursorTo(process.stdout, 0);
        for (let i = 0; i < this.renderedLines; i++) {
          readline.moveCursor(process.stdout, 0, -1);
          readline.clearLine(process.stdout, 0);
        }
      }

      // Write updated lines
      for (const l of lines) {
        process.stdout.write(`${l}\n`);
      }
      this.renderedLines = lines.length;
    } else {
      // Fallback for non-TTY environments
      const summary = taskList
        .map((t) => `${t.label}: ${t.percent}% (${t.status})`)
        .join(' | ');
      process.stdout.write(`\r[Progress] ${summary}`);
    }
  }

  finish() {
    this.render();
    if (!this.isTTY) {
      process.stdout.write('\n');
    }
  }
}
