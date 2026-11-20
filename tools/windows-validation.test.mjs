import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchWebView2Processes } from './windows-validation.mjs';

test('matchWebView2Processes finds direct child WebView2 process', () => {
  const processes = [
    { ProcessId: 1000, ParentProcessId: 500, Name: 'bestway-app.exe' },
    { ProcessId: 2000, ParentProcessId: 1000, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe --embedded-browser-webview' },
  ];
  const matched = matchWebView2Processes(processes, 1000);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].ProcessId, 2000);
});

test('matchWebView2Processes finds indirect descendant processes (renderer and GPU)', () => {
  const processes = [
    { ProcessId: 1000, ParentProcessId: 500, Name: 'bestway-app.exe' },
    { ProcessId: 2000, ParentProcessId: 1000, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe' },
    { ProcessId: 2001, ParentProcessId: 2000, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe --type=gpu-process' },
    { ProcessId: 2002, ParentProcessId: 2000, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe --type=renderer' },
  ];
  const matched = matchWebView2Processes(processes, 1000);
  assert.equal(matched.length, 3);
  assert.deepEqual(matched.map(p => p.ProcessId), [2000, 2001, 2002]);
});

test('matchWebView2Processes finds brokered descendant when parent is intermediate broker', () => {
  const processes = [
    { ProcessId: 1000, ParentProcessId: 500, Name: 'bestway-app.exe' },
    { ProcessId: 1500, ParentProcessId: 1000, Name: 'runtimebroker.exe' },
    { ProcessId: 2500, ParentProcessId: 1500, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe' },
  ];
  const matched = matchWebView2Processes(processes, 1000);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].ProcessId, 2500);
});

test('matchWebView2Processes finds process by command line attributing host executable', () => {
  const processes = [
    { ProcessId: 1000, ParentProcessId: 500, Name: 'bestway-app.exe' },
    // Reparented to PID 1 (e.g. system/services/job breakout) but command line has host exe
    { ProcessId: 3000, ParentProcessId: 1, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe --embedded-browser-webview --webview-exe-name=bestway-app.exe' },
  ];
  const matched = matchWebView2Processes(processes, 1000);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].ProcessId, 3000);
});

test('matchWebView2Processes ignores unrelated WebView2 processes from other applications', () => {
  const processes = [
    { ProcessId: 1000, ParentProcessId: 500, Name: 'bestway-app.exe' },
    { ProcessId: 2000, ParentProcessId: 1000, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe --webview-exe-name=bestway-app.exe' },
    // Unrelated teams or vscode webview2
    { ProcessId: 8888, ParentProcessId: 7777, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe --webview-exe-name=ms-teams.exe' },
    { ProcessId: 9999, ParentProcessId: 7777, Name: 'msedgewebview2.exe', CommandLine: 'msedgewebview2.exe --user-data-dir="C:\\Users\\test\\AppData\\Local\\Microsoft\\Teams"' },
  ];
  const matched = matchWebView2Processes(processes, 1000);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].ProcessId, 2000);
});

test('matchWebView2Processes handles empty process lists and invalid PIDs safely', () => {
  assert.deepEqual(matchWebView2Processes([], 1000), []);
  assert.deepEqual(matchWebView2Processes(null, 1000), []);
  assert.deepEqual(matchWebView2Processes([{ ProcessId: 1 }], 0), []);
});
