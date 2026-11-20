/**
 * Identifies WebView2 runtime processes that belong to a specific application host.
 *
 * In Windows CI and low-resource environments, WebView2 may start as an immediate
 * child of the host process, as an indirect descendant through a broker, or as a
 * specialized runtime process carrying the host's executable name or app identifier.
 *
 * @param {Array<{ProcessId: number, ParentProcessId: number, Name: string, CommandLine?: string}>} processes
 * @param {number} appPid
 * @param {string} [appExeName='bestway-app.exe']
 * @param {string} [appIdentifier='uz.bestwayec.app']
 * @returns {Array<{ProcessId: number, ParentProcessId: number, Name: string, CommandLine?: string}>}
 */
export function matchWebView2Processes(processes, appPid, appExeName = 'bestway-app.exe', appIdentifier = 'uz.bestwayec.app') {
  if (!appPid || !Array.isArray(processes)) return [];

  // Build recursive descendant PID set
  const descendantPids = new Set();
  const queue = [appPid];

  while (queue.length > 0) {
    const parent = queue.shift();
    for (const p of processes) {
      if (p.ParentProcessId === parent && !descendantPids.has(p.ProcessId)) {
        descendantPids.add(p.ProcessId);
        queue.push(p.ProcessId);
      }
    }
  }

  return processes.filter(p => {
    if (!p.Name || p.Name.toLowerCase() !== 'msedgewebview2.exe') return false;

    // 1. Direct child
    if (p.ParentProcessId === appPid) return true;

    // 2. Indirect descendant (grandchild, renderer, GPU process)
    if (descendantPids.has(p.ProcessId)) return true;

    // 3. Command line attribution to host executable or app identifier
    if (p.CommandLine) {
      const cmd = p.CommandLine.toLowerCase();
      if (appExeName && cmd.includes(appExeName.toLowerCase())) return true;
      if (appIdentifier && cmd.includes(appIdentifier.toLowerCase())) return true;
    }

    return false;
  });
}
