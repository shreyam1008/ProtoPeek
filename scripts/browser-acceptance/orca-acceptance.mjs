import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

// Orca 46 logs immediately before invoking its Speech Dispatcher client:
// https://raw.githubusercontent.com/GNOME/orca/ORCA_46_1/src/orca/speechdispatcherfactory.py
// These checks establish real Orca dispatch attempts, not synthesized or audible sound.
const { RUNNER_TEMP, PROTOPEEK_ORCA_BINARY, PROTOPEEK_ORCA_LOG, PROTOPEEK_ORCA_REPORT } = process.env;
assert.ok(RUNNER_TEMP && PROTOPEEK_ORCA_BINARY && PROTOPEEK_ORCA_LOG && PROTOPEEK_ORCA_REPORT);
const run = await mkdtemp(path.join(RUNNER_TEMP, 'protopeek-orca-profile-'));
const appConfig = path.join(run, 'config');
const appCache = path.join(run, 'cache');
await mkdir(appConfig);
await mkdir(appCache);
let child, browser, fixture;
let report = 'Orca navigation acceptance started.\n';

async function debugText() {
  return readFile(PROTOPEEK_ORCA_LOG, 'utf8').catch(() => '');
}
async function waitForSpeech(start, pattern, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const lines = (await debugText()).slice(start).split('\n');
    if (lines.some((line) => line.includes('SPEECH DISPATCHER: Speaking') && pattern.test(line))) {
      report += `PASS Orca dispatch attempt: ${label}\n`;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Orca did not dispatch the expected ${label} utterance after keyboard navigation`);
}

try {
  fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('orca-loopback-fixture');
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
  const hash = createHash('sha256').update(await readFile(PROTOPEEK_ORCA_BINARY)).digest('hex');
  report += `Native launcher SHA-256: ${hash}\n`;
  child = spawn(PROTOPEEK_ORCA_BINARY, ['-port=0', '-open-browser=false'], {
    env: { ...process.env, XDG_CONFIG_HOME: appConfig, XDG_CACHE_HOME: appCache },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native launcher did not become ready')), 20000);
    let output = '';
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Native launcher exited before ready: ${code}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/ProtoPeek available at (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });

  browser = await chromium.launch({
    headless: false,
    args: ['--force-renderer-accessibility', '--disable-background-networking', '--no-first-run'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || !['http:', 'ws:'].includes(url.protocol))
      throw new Error('Unexpected external browser request blocked');
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${base}#/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'What do you need to check?' }).waitFor({ state: 'visible' });
  await page.bringToFront();
  await page.keyboard.press('Control+k');
  const commands = page.getByRole('dialog', { name: 'ProtoPeek commands' });
  await commands.waitFor({ state: 'visible' });
  const search = commands.getByRole('combobox', { name: 'Search commands' });
  // The dialog deliberately focuses its input on the next animation frame.
  // Keep the focus assertion, but wait for that user-visible state to settle.
  await page.waitForFunction(
    () => document.activeElement?.matches('[aria-label="Search commands"]'),
    null,
    { timeout: 10000 }
  );
  assert.ok(await search.evaluate((node) => node === document.activeElement), 'Find did not focus search');
  await page.keyboard.type('HTTP');
  const selected = commands.locator('[role="option"][aria-selected="true"]');
  assert.match(await selected.innerText(), /Open HTTP workbench/);
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/protocols\/http$/);
  await page.waitForFunction(() =>
    document.activeElement?.matches('#pp-workbench-canvas h1') &&
    document.activeElement.textContent.includes('Request workbench')
  );
  const url = page.getByRole('textbox', { name: 'Request URL' });
  const send = page.getByRole('button', { name: /^Send/ });
  await url.waitFor({ state: 'visible', timeout: 15000 });
  let marker = (await debugText()).length;
  await page.keyboard.press('Tab');
  const skip = page.getByRole('button', { name: 'Skip to request URL' });
  await skip.waitFor({ state: 'visible', timeout: 10000 });
  assert.ok(await skip.evaluate((node) => node === document.activeElement), 'First Tab did not focus Skip to request URL');
  await waitForSpeech(marker, /skip\s+to\s+request\s+url/i, 'Skip to request URL');
  marker = (await debugText()).length;
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.activeElement?.matches('input[aria-label="Request URL"]'),
    null,
    { timeout: 10000 }
  );
  assert.ok(await url.evaluate((node) => node === document.activeElement), 'Skip did not focus Request URL');
  // Do not accept a delayed announcement of the skip button as the URL announcement.
  await waitForSpeech(marker, /^(?!.*skip\s+to\s+request\s+url).*request\s+url/i, 'Request URL');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(fixtureUrl);
  assert.equal(await url.inputValue(), fixtureUrl, 'Keyboard did not enter the fixture URL');
  marker = (await debugText()).length;
  await page.keyboard.press('Tab');
  assert.ok(await send.evaluate((node) => node === document.activeElement), 'Tab did not focus Send');
  await waitForSpeech(marker, /\bSend\b/i, 'Send');
  marker = (await debugText()).length;
  await page.keyboard.press('Enter');
  await page.locator('[aria-label="HTTP response evidence"]').getByText('orca-loopback-fixture')
    .waitFor({ state: 'visible', timeout: 15000 });
  const summary = page.locator('.pp-http-response-summary');
  assert.equal(await summary.getAttribute('aria-live'), 'polite');
  assert.match(await summary.innerText(), /\b200\s+OK\b/);
  await waitForSpeech(marker, /\b200\s+OK\b/i, 'HTTP response 200 OK');
  report += 'PASS keyboard Send returned the owned loopback fixture.\n';
  report += 'Scope: Orca dispatch attempts only; audio synthesis and audible output were not checked.\n';
  console.log(report);
} catch (error) {
  report += `FAIL ${error.message}\n`;
  // Only capture speech attempts from this isolated, local-only session, not raw debug logs.
  const debug = await debugText();
  report += `Orca settings loaded: ${debug.includes('ORCA: User Settings Loaded')}\n`;
  report += `Speech Dispatcher connection error: ${debug.includes('ERROR: Speech Dispatcher service failed to connect')}\n`;
  const speech = debug.split('\n')
    .filter((line) => line.includes('SPEECH DISPATCHER: Speaking'))
    .slice(-40).join('\n');
  report += `Recent Orca dispatch attempts:\n${speech}\n`;
  console.error(report);
  process.exitCode = 1;
} finally {
  await writeFile(PROTOPEEK_ORCA_REPORT, report);
  if (browser) await browser.close();
  if (fixture) await new Promise((resolve) => fixture.close(resolve));
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await rm(run, { recursive: true, force: true });
}
