import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
let repository = scriptDirectory;
while (
  !existsSync(path.join(repository, 'go.mod')) ||
  !existsSync(path.join(repository, 'web/src/console/app/feature-registry.ts'))
) {
  const parent = path.dirname(repository);
  if (parent === repository) throw new Error('ProtoPeek repository root not found');
  repository = parent;
}
const temporaryRoot = process.env.RUNNER_TEMP || tmpdir();
const safeRoot = await realpath(temporaryRoot);
const run = await mkdtemp(path.join(safeRoot, 'protopeek-browser-'));
const safeRun = await realpath(run);
assert.ok(
  safeRun.startsWith(safeRoot + path.sep),
  'temporary run directory escaped the temporary root'
);
const failureScreenshot = path.join(safeRoot, `${path.basename(run)}-failure.png`);
const exe = path.join(run, process.platform === 'win32' ? 'pp.exe' : 'pp');
const dirs = Object.fromEntries(
  ['home', 'config', 'cache', 'roaming', 'local', 'temp'].map((name) => [name, path.join(run, name)])
);
const env = {
  ...process.env,
  HOME: dirs.home,
  USERPROFILE: dirs.home,
  XDG_CONFIG_HOME: dirs.config,
  XDG_CACHE_HOME: dirs.cache,
  APPDATA: dirs.roaming,
  LOCALAPPDATA: dirs.local,
  TMP: dirs.temp,
  TEMP: dirs.temp,
  TMPDIR: dirs.temp,
  PROTOPEEK_AGENT_CONNECTION: path.join(run, 'pairing.json'),
};
const failures = [];
let child, browser, fixture, activePage;

function check(condition, message) {
  if (!condition) throw new Error(message);
}
async function press(page, locator) {
  if ((page.viewportSize()?.width ?? 0) < 500) await locator.tap();
  else await locator.click();
}
const requiredInitialAnchors = new Set([
  'overview',
  'protocols',
  'grpc',
  'http',
  'events',
  'capnp',
  'network',
  'network-local',
  'network-ports',
  'network-diagnostics',
  'network-route',
  'network-nmap',
  'network-packets',
  'network-path',
  'netbird',
  'tailnet',
  'extensions',
  'tunnels',
  'publishing',
  'downloader',
  'security',
  'settings',
  'roadmap',
]);
let tourDefinitions, helpDefinitions;
async function startLauncher() {
  const build = spawnSync('go', ['build', '-mod=readonly', '-tags', 'protopeek_lite', '-o', exe, './cmd/pp'], {
    cwd: repository,
    env: process.env,
    encoding: 'utf8',
    timeout: 360000,
  });
  check(build.status === 0, `launcher build failed: ${build.stderr}`);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' });
  const changed = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: repository,
    encoding: 'utf8',
  });
  check(head.status === 0 && changed.status === 0, 'could not identify checkout');
  const digest = createHash('sha256')
    .update(await readFile(exe))
    .digest('hex');
  console.log(
    `Checkout ${head.stdout.trim()} (working tree changes: ${changed.stdout.trim() ? 'yes' : 'no'}); launcher SHA-256 ${digest}`
  );
  child = spawn(exe, ['-port=0', '-open-browser=false'], {
    cwd: repository,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`launcher did not start: ${stderr}`)), 20000);
    child.on('error', reject);
    child.once('exit', (code) =>
      reject(new Error(`launcher exited before ready (${code}): ${stderr}`))
    );
    child.stdout.on('data', (data) => {
      stdout += data;
      const found = stdout.match(/ProtoPeek available at (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (found) {
        clearTimeout(timer);
        resolve(found[1]);
      }
    });
  });
  return base;
}
async function openHelp(page) {
  const desktop = page.locator('[aria-label="Open ProtoPeek help"]');
  if (await desktop.isVisible()) await press(page, desktop);
  else {
    await press(page, page.getByRole('button', { name: 'Open navigation menu' }));
    await press(page, page.getByRole('button', { name: 'Help', exact: true }));
  }
  const help = page.getByRole('dialog', { name: 'Help for this tool' });
  await help.waitFor({ state: 'visible' });
  return help;
}
async function readyPage(page, base, route) {
  await page.goto(`${base}#${route}`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('#pp-workbench-canvas h1')
    .first()
    .waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForFunction(
    () => {
      const title = document.querySelector('#pp-workbench-canvas h1');
      return title && !/^(Loading|Preparing)/i.test(title.textContent.trim());
    },
    null,
    { timeout: 15000 }
  );
}
async function walkGuide(page, feature) {
  const help = await openHelp(page);
  const topic = help.getByRole('combobox', { name: 'Help topic' });
  if ((await topic.inputValue()) !== feature.id) await topic.selectOption(feature.id);
  const start = help.getByRole('button', { name: 'Start guided steps' });
  if (await start.isVisible()) await press(page, start);
  else await press(page, help.getByRole('button', { name: /and start guided steps$/ }));
  const guide = page.locator('.pp-tool-tour');
  await guide.waitFor({ state: 'visible', timeout: 15000 });
  if (feature.expectedName)
    check(
      (await guide.getAttribute('aria-label')) === feature.expectedName,
      `${feature.id}: wrong contextual guide`
    );
  const progress = await guide.locator('header span').innerText();
  const total = Number(progress.match(/1 of (\d+)/)?.[1]);
  check(
    Number.isInteger(total) && total > 0 && total <= 10,
    `${feature.id}: invalid guide progress ${progress}`
  );
  const actualFeature = await page.locator('#pp-workbench-canvas').getAttribute('data-feature');
  const isMedia = feature.expectedName === 'Media downloader guided steps';
  const selectors = isMedia
    ? tourDefinitions.mediaTourTargets
    : tourDefinitions.tourTargets[actualFeature];
  const expectedSteps = isMedia
    ? helpDefinitions.mediaDownloadHelp.steps
    : helpDefinitions.toolHelp[actualFeature]?.steps;
  check(
    selectors && expectedSteps && selectors.length === total && expectedSteps.length === total,
    `${feature.id}: guide steps differ from actual registered data`
  );
  let anchored = 0;
  for (let index = 1; index <= total; index++) {
    const state = await page.waitForFunction(
      ({ expected, selector }) => {
        const panel = document.querySelector('.pp-tool-tour');
        const target = document.querySelector('.pp-tour-target');
        const go = panel?.querySelector('.pp-tour-show');
        const fallback = [...(panel?.querySelectorAll('button') ?? [])].find(
          (button) => button.textContent.trim() === 'Find this step' && button.getClientRects().length
        );
        if (!panel?.querySelector('header span')?.textContent.includes(`${expected} of `))
          return false;
        if (target && go?.getClientRects().length && target.matches(selector)) return 'target';
        const available = [...document.querySelectorAll(`#pp-workbench-canvas ${selector}`)].some(
          (node) =>
            !node.matches(':disabled') &&
            !node.closest('[hidden], [inert], [aria-hidden="true"]') &&
            getComputedStyle(node).visibility !== 'hidden' &&
            node.getClientRects().length
        );
        const note = fallback?.parentElement?.querySelector('.pp-tour-note')?.textContent.trim();
        return !target && !available && fallback && note?.length > 10 ? 'fallback' : false;
      },
      { expected: index, selector: selectors[index - 1] }
    );
    const outcome = await state.jsonValue();
    await state.dispose();
    const go = guide.getByRole('button', { name: 'Go to highlighted area' });
    if (index === 1 && (requiredInitialAnchors.has(feature.id) || isMedia))
      await go.waitFor({ state: 'visible', timeout: 10000 });
    if (outcome === 'target' || (index === 1 && (requiredInitialAnchors.has(feature.id) || isMedia))) {
      anchored++;
      await press(page, go);
      check(
        await page.evaluate(
          () =>
            document.querySelectorAll('.pp-tour-target').length === 1 &&
            document.activeElement === document.querySelector('.pp-tour-target')
        ),
        `${feature.id} step ${index}: highlight did not receive focus`
      );
    } else check(outcome === 'fallback', `${feature.id} step ${index}: missing target and prerequisite`);
    if (index < total) await press(page, guide.getByRole('button', { name: 'Next' }));
    else await press(page, guide.getByRole('button', { name: 'Done' }));
  }
  await guide.waitFor({ state: 'hidden' });
  check(
    (await page.locator('.pp-tour-target').count()) === 0,
    `${feature.id}: highlight survived guide closure`
  );
  return `${anchored}/${total} visible anchors`;
}
async function operations(page, base, port) {
  await readyPage(page, base, '/protocols/http');
  await page.getByRole('textbox', { name: 'Request URL' }).fill(`http://127.0.0.1:${port}/echo`);
  await press(page, page.locator('.pp-http-send'));
  await page
    .locator('[aria-label="HTTP response evidence"]')
    .getByText('protopeek-loopback-fixture')
    .waitFor({ state: 'visible', timeout: 15000 });
  console.log('PASS owned HTTP request');
  await readyPage(page, base, '/network/ports');
  await page.getByLabel('Host or IP').fill('127.0.0.1');
  await page.getByLabel('Ports', { exact: true }).fill(String(port));
  await press(page, page.getByRole('button', { name: 'Scan ports' }));
  await page
    .locator('.pp-ports-table')
    .getByText('open', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  console.log('PASS owned TCP port scan');
  await readyPage(page, base, '/network/diagnostics');
  await page.locator('.pp-diag-target select').selectOption('subnet');
  await page.getByLabel('CIDR prefix').fill('192.0.2.0/24');
  await press(page, page.getByRole('button', { name: 'Calculate' }));
  await page
    .getByLabel('Diagnostic result')
    .getByText('256', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  console.log('PASS offline subnet planning');
  await readyPage(page, base, '/extensions?extension=cloudflared');
  await press(page, page.getByRole('button', { name: 'Check companion status' }));
  const managed = page.getByRole('region', { name: 'Optional managed companion' });
  await managed
    .getByText(/Available|Installed|External tool found|Unavailable|Needs attention/)
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  console.log('PASS local managed companion inventory');
}

try {
  for (const directory of Object.values(dirs)) await mkdir(directory, { recursive: true });
  const registry = await import(
    pathToFileURL(path.join(repository, 'web/src/console/app/feature-registry.ts')).href
  );
  tourDefinitions = await import(
    pathToFileURL(path.join(repository, 'web/src/console/tour-targets.ts')).href
  );
  helpDefinitions = await import(
    pathToFileURL(path.join(repository, 'web/src/console/tool-help.ts')).href
  );
  const features = registry.featureRegistry;
  check(
    features.length > 0 && new Set(features.map((feature) => feature.id)).size === features.length,
    'feature registry is empty or contains duplicate ids'
  );
  const base = await startLauncher();
  fixture = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ marker: 'protopeek-loopback-fixture' }));
  });
  await new Promise((resolve, reject) => {
    fixture.once('error', reject);
    fixture.listen(0, '127.0.0.1', resolve);
  });
  const port = fixture.address().port;
  browser = await chromium.launch({ headless: true });
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.name === 'mobile',
      hasTouch: viewport.name === 'mobile',
    });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(8000);
    let phase = 'tours';
    page.on('pageerror', (error) =>
      failures.push(`${viewport.name}: page error: ${error.message}`)
    );
    page.on('console', (message) => {
      if (message.type() === 'error')
        failures.push(`${viewport.name}: console error: ${message.text()}`);
    });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.hostname !== '127.0.0.1' ||
        (Number(url.port) !== Number(new URL(base).port) && Number(url.port) !== port)
      ) {
        failures.push(`${viewport.name}: blocked non-fixture request: ${url.origin}`);
        await route.abort();
      } else if (!['GET', 'HEAD'].includes(request.method())) {
        let body;
        try {
          body = JSON.parse(request.postData() || 'null');
        } catch {
          body = null;
        }
        const snapshot =
          request.method() === 'POST' &&
          url.pathname === '/api/local-share/snapshot' &&
          request.postData() === '{}';
        const fixtureHTTP =
          phase === 'operations' &&
          request.method() === 'POST' &&
          url.pathname === '/api/http/request' &&
          body?.method === 'GET' &&
          body?.url === `http://127.0.0.1:${port}/echo`;
        const fixtureScan =
          phase === 'operations' &&
          request.method() === 'POST' &&
          url.pathname === '/api/ports/scan' &&
          body?.host === '127.0.0.1' &&
          body?.ports === String(port);
        const offlineSubnet =
          phase === 'operations' &&
          request.method() === 'POST' &&
          url.pathname === '/api/network/diagnostics' &&
          body?.mode === 'subnet' &&
          body?.target === '192.0.2.0/24';
        if (snapshot || fixtureHTTP || fixtureScan || offlineSubnet) await route.continue();
        else {
          failures.push(`${viewport.name}: blocked unexpected ${request.method()} ${url.pathname}`);
          await route.abort();
        }
      } else await route.continue();
    });
    await readyPage(page, base, '/protocols/http');
    const quickGuide = page.getByRole('button', { name: 'Start guide for this tool' });
    await press(page, quickGuide);
    await page.getByRole('region', { name: 'HTTP guided steps' }).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.getByRole('region', { name: 'HTTP guided steps' }).waitFor({ state: 'hidden' });
    if (viewport.name === 'mobile') {
      await press(page, page.getByRole('button', { name: 'Search tools' }));
      await page.getByRole('dialog', { name: 'ProtoPeek commands' }).waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'ProtoPeek commands' }).waitFor({ state: 'hidden' });
      const tools = page.getByRole('button', { name: 'Request tools' });
      await press(page, tools);
      check(!(await page.getByRole('textbox', { name: 'Request URL' }).isVisible()), 'open tools exposed the request workspace');
      await page.keyboard.press('Escape');
      check((await tools.getAttribute('aria-expanded')) === 'false', 'request tools did not close');
      check(await tools.evaluate((button) => document.activeElement === button), 'request tools lost focus');
      check(await page.getByRole('textbox', { name: 'Request URL' }).isVisible(), 'request workspace did not return');
      await press(page, tools);
      await press(page, page.getByRole('button', { name: 'Import OpenAPI' }));
      const importer = page.getByRole('dialog', { name: 'Import API definition' });
      await importer.waitFor({ state: 'visible' });
      await press(page, importer.getByRole('button', { name: 'Close API definition import' }));
      await importer.waitFor({ state: 'hidden' });
      check(await tools.evaluate((button) => document.activeElement === button), 'import close lost focus');
      await page.setViewportSize({ width: 320, height: 568 });
      const sendIsUnobstructed = () => page.locator('.pp-http-send').evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 2);
        return hit === button || button.contains(hit);
      });
      check(await sendIsUnobstructed(), '320px Send button is covered');
      await page.evaluate(() => localStorage.setItem('protopeek.httpDraft.v1', JSON.stringify({
        version: 1, method: 'GET', url: 'http://127.0.0.1/', params: [], headers: [],
        bodyMode: 'none', body: '', rememberBody: false, timeoutSeconds: 30, followRedirects: false,
      })));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText(/Draft restored/).waitFor({ state: 'visible' });
      check(await sendIsUnobstructed(), '320px Send button is covered with a draft notice');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    }
    console.log(`PASS ${viewport.name} direct guide${viewport.name === 'mobile' ? ' and search' : ''}`);
    for (const feature of features) {
      await readyPage(page, base, feature.route);
      const coverage = await walkGuide(page, feature);
      console.log(`PASS ${viewport.name} ${feature.id} guide (${coverage})`);
    }
    await readyPage(page, base, '/downloader?mediaTool=gallery-dl');
    await walkGuide(page, { id: 'downloader', expectedName: 'Media downloader guided steps' });
    console.log(`PASS ${viewport.name} media handoff guide`);
    phase = 'operations';
    await operations(page, base, port);
    await context.close();
  }
  check(failures.length === 0, failures.join('\n'));
  console.log(
    `PASS ${features.length} registry entries across desktop and mobile; no unexpected page errors or external browser requests`
  );
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: failureScreenshot }).catch(() => {});
    console.error(`Failure screenshot: ${failureScreenshot}`);
  }
  console.error(error.stack || error);
  if (failures.length) console.error(failures.join('\n'));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (fixture) await new Promise((resolve) => fixture.close(resolve));
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  await rm(safeRun, { recursive: true });
}
