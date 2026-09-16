import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const useProcessGroups = process.platform !== 'win32';
const children = [];
let stopping = false;

function start(args) {
  const child = spawn(npm, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    detached: useProcessGroups,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      if (signal) console.error(`A development process stopped with ${signal}.`);
      else if (code) console.error(`A development process stopped with exit code ${code}.`);
      stop(code || (signal ? 1 : 0));
    }
  });
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (useProcessGroups) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {}
  }
  setTimeout(() => process.exit(exitCode), 100).unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start(['--prefix', 'server', 'run', 'dev']);
start(['run', 'dev:frontend']);
