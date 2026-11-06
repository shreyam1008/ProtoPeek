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
const responsePhases = [];

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
  let requests = 0;
  fixture = createServer((_request, response) => {
    requests++;
    response.writeHead(requests === 1 ? 200 : 202, { 'content-type': 'text/plain' });
    response.end(`orca-loopback-fixture-${requests}`);
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
  const summary = page.locator('.pp-http-response-summary');
  const announcement = page.locator('.pp-http-result-announcement');
  const hasNativeNotifications = await page.evaluate(() => typeof document.ariaNotify === 'function');
  assert.equal(await announcement.getAttribute('aria-live'), 'polite');
  assert.equal(await announcement.getAttribute('aria-atomic'), 'true');
  for (const [index, status] of ['200 OK', '202 Accepted'].entries()) {
    assert.ok(await send.evaluate((node) => node === document.activeElement), 'Send lost keyboard focus');
    marker = (await debugText()).length;
    responsePhases.push({ status, start: marker });
    await page.keyboard.press('Enter');
    await page.locator('[aria-label="HTTP response evidence"]').getByText(`orca-loopback-fixture-${index + 1}`)
      .waitFor({ state: 'visible', timeout: 15000 });
    assert.ok((await summary.innerText()).includes(status));
    const result = `HTTP response ${status}`;
    const fallbackText = await announcement.textContent();
    assert.ok(fallbackText === result + '.' || (hasNativeNotifications && fallbackText === ''),
      'Unexpected final response announcement');
    report += `Response ${status} via ${fallbackText ? 'live region' : 'platform notification'}.\n`;
    await waitForSpeech(marker, new RegExp(result, 'i'), result);
  }
  assert.equal(requests, 2);
  report += 'PASS keyboard Send returned both owned loopback responses.\n';
  report += 'Scope: Orca dispatch attempts only; audio synthesis and audible output were not checked.\n';
  console.log(report);
} catch (error) {
  report += `FAIL ${error.message}\n`;
  // Do not upload Orca's raw debug log: it can contain field values and object names.
  // Keep only fixed categories, timestamps and the two known local fixture statuses.
  const debug = await debugText();
  report += `Orca settings loaded: ${debug.includes('ORCA: User Settings Loaded')}\n`;
  report += `Speech Dispatcher connection error: ${debug.includes('ERROR: Speech Dispatcher service failed to connect')}\n`;
  const knownMessages = [
    'Skip to request URL', 'Request URL', 'Send', 'Cancel',
    'HTTP response 200 OK', 'HTTP response 202 Accepted',
  ];
  const handlers = [
    'WEB: Event to be handled as live region',
    'WEB: Ignoring because live region event not to be handled.',
    'WEB: Event is believed to be duplicate message',
    'WEB: Event is believed to be redundant live region notification',
    'WEB: Live region source is not in active tab.',
    'WEB: Ignoring deletion from live region',
    'EVENT MANAGER: Ignoring event type due to deluge',
    'EVENT MANAGER: Not processing this event due to flood.',
    'EVENT MANAGER: Pruning event queue due to flood.',
    'PRESENT LIVE REGION MESSAGE',
  ];
  function diagnostic(line) {
    const time = line.match(/\b\d{2}:\d{2}:\d{2}\.\d+\b/)?.[0] ?? 'time unavailable';
    if (line.includes('SPEECH DISPATCHER: Speaking')) {
      const message = knownMessages.find((text) => line.includes(text));
      return message ? `${time} speech: ${message}` : null;
    }
    const event = line.match(/object:(?:text-changed:(?:insert|delete)|children-changed:add)/)?.[0];
    if (event) {
      const queue = line.match(/EVENT MANAGER: (Queueing|Dequeued|Pruning|Not pruning)/)?.[1];
      const status = line.match(/\b(?:200 OK|202 Accepted)\b/)?.[0];
      return `${time} ${queue ?? 'event'} ${event}${status ? ` ${status}` : ''}`;
    }
    const handler = handlers.find((text) => line.includes(text));
    return handler ? `${time} ${handler}` : null;
  }
  const speech = debug.split('\n')
    .filter((line) => line.includes('SPEECH DISPATCHER: Speaking'))
    .map(diagnostic).filter(Boolean).slice(-40);
  report += `Redacted recent Orca dispatch attempts:\n${speech.join('\n')}\n`;
  for (const [index, phase] of responsePhases.entries()) {
    const end = responsePhases[index + 1]?.start ?? debug.length;
    const lines = debug.slice(phase.start, end).split('\n').map(diagnostic).filter(Boolean);
    report += `Redacted Orca/AT-SPI diagnostics for ${phase.status} (${lines.length} matching lines; last 100):\n`;
    report += `${lines.slice(-100).join('\n')}\n`;
  }
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
