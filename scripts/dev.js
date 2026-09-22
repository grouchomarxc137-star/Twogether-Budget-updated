import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const useProcessGroups = process.platform !== 'win32';
const children = [];
let stopping = false;

function start(args, extraEnv = {}) {
  const child = spawn(npm, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    detached: useProcessGroups,
    env: { ...process.env, ...extraEnv },
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

// The frontend (Vite) listens on PORT when one is given (e.g. a preview tool
// assigning a free port so two copies can run side by side), else 5180. The
// API server keeps 4310 for the default setup; with any other frontend port
// it takes a free port, so a second copy never collides with the first. Both
// ports are passed explicitly to each child, never inherited by accident.
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, () => { const { port } = probe.address(); probe.close(() => resolvePort(port)); });
  });
}

const frontendPort = Number(process.env.PORT) || 5180;
const apiPort = Number(process.env.API_PORT) || (frontendPort === 5180 ? 4310 : await freePort());
const origins = `http://localhost:${frontendPort},http://127.0.0.1:${frontendPort}`;

start(['--prefix', 'server', 'run', 'dev'], { PORT: String(apiPort), ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || origins });
start(['run', 'dev:frontend'], { PORT: String(frontendPort), VITE_API_PORT: String(apiPort) });
