// Preloaded into the `bdk serve` child process via `--import`.
//
// 1. `@cursor/bdk` registers an `uncaughtException` guard that treats `EPIPE`
//    as HTTP/2 transport noise and logs to `process.stderr.write(...)`. When the
//    parent process closes its stdio pipes, writing to stdout/stderr without a
//    stream error listener raises an uncaught `EPIPE`, which logs to the broken
//    stderr pipe and triggers another `EPIPE` on `setImmediate`, spinning a CPU
//    core forever. Swallowing `EPIPE` on stdout/stderr prevents that loop.
// 2. `startServe` keeps `stdin` open as a pipe. If the parent process dies
//    abruptly (e.g. `SIGKILL`) without running JS exit hooks, the OS closes the
//    pipe and `stdin` emits `end`/`close`, allowing `bdk serve` to shut itself
//    down instead of lingering under launchd/init.

const ignoreBrokenPipe = (error) => {
  if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") return;
  throw error;
};

process.stdout?.on?.("error", ignoreBrokenPipe);
process.stderr?.on?.("error", ignoreBrokenPipe);

if (process.stdin && !process.stdin.isTTY) {
  let shuttingDown = false;
  const onParentGone = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      process.stdin.destroy();
    } catch {}
    setTimeout(() => process.exit(0), 5_000).unref();
    try {
      process.kill(process.pid, "SIGTERM");
    } catch {
      process.exit(0);
    }
  };
  process.stdin.resume();
  process.stdin.once("end", onParentGone);
  process.stdin.once("close", onParentGone);
  process.stdin.once("error", onParentGone);
  process.stdin.unref?.();
}
