#!/usr/bin/env python3
"""Connect real agent clients to a paired local launcher in a loopback-only Linux namespace.

The workflow verifies vendor artifacts before entering the namespace. This script
never calls a model, signs in, or claims the clients executed an MCP tool.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request


def run(command, *, cwd, env, timeout=60):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    output = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', result.stdout)
    if result.returncode:
        raise RuntimeError(f'{Path(command[0]).name} exited {result.returncode}: {(output + result.stderr)[-1000:]}')
    return output


def wait_for_launcher(process):
    deadline = time.monotonic() + 20
    output = ''
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('launcher exited before readiness')
        if select.select([process.stdout], [], [], 0.2)[0]:
            output += os.read(process.stdout.fileno(), 4096).decode('utf-8', errors='replace')
            match = re.search(r'ProtoPeek available at (http://127\.0\.0\.1:\d+/)', output)
            if match:
                return match.group(1)
    raise RuntimeError('launcher did not bind loopback within 20 seconds')


def connected(line):
    return bool(re.search(r'\bconnected\b', line, re.IGNORECASE)) and not re.search(
        r'\b(?:not\s+connected|disconnected|failed|error|disabled|unreachable)\b', line, re.IGNORECASE
    )


def main():
    if len(sys.argv) != 6 or sys.platform != 'linux':
        raise SystemExit('usage: native-agent-clients.py REPO PP ASSETS NODE RUNNER_TEMP')
    repo, pp, assets, node, temporary = map(lambda p: Path(p).resolve(strict=True), sys.argv[1:])
    links = json.loads(subprocess.check_output(['ip', '-j', 'link'], text=True))
    if [item['ifname'] for item in links] != ['lo']:
        raise RuntimeError('expected an isolated network namespace with loopback only')
    if subprocess.check_output(['ip', 'route', 'show', 'default'], text=True).strip():
        raise RuntimeError('namespace has a default route')

    with tempfile.TemporaryDirectory(prefix='protopeek-agent-clients-', dir=temporary) as name:
        root = Path(name)
        pairing = root / 'pairing' / 'connection.json'
        app_config = root / 'app-config'
        app_config.mkdir()
        app_env = {
            'PATH': os.environ['PATH'], 'HOME': str(root), 'XDG_CONFIG_HOME': str(app_config),
            'XDG_CACHE_HOME': str(root / 'app-cache'), 'PROTOPEEK_AGENT_CONNECTION': str(pairing),
        }
        launcher = subprocess.Popen([str(pp), '-port=0', '-open-browser=false'], cwd=root, env=app_env,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        try:
            base = wait_for_launcher(launcher)
            cookies = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookies))
            with opener.open(base, timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError('launcher homepage failed')
                response.read()
            csrf = next((cookie.value for cookie in cookies if cookie.name == '_protopeek_csrf_token'), None)
            if not csrf:
                raise RuntimeError('launcher did not issue a CSRF cookie')
            request = urllib.request.Request(
                urllib.parse.urljoin(base, 'api/agent/control'),
                data=json.dumps({'action': 'enable', 'allowWrites': False}).encode(),
                headers={'Content-Type': 'application/json', 'Origin': base.rstrip('/'), 'x-protopeek-csrf-token': csrf},
                method='POST',
            )
            with opener.open(request, timeout=10) as response:
                state = json.load(response)
            if not state.get('enabled') or state.get('allowWrites') or not pairing.is_file():
                raise RuntimeError('read-only pairing was not established')
            print('PASS isolated loopback launcher and read-only pairing', flush=True)

            generator = (
                "import { agentClientConfig } from './web/src/console/agent-client-config.ts'; "
                "const value = agentClientConfig(process.argv[1], process.argv[2], process.argv[3]); "
                "if (!value) process.exit(2); console.log(value);"
            )
            clients = [
                ('opencode', '1.19.5', [str(assets / 'opencode' / 'opencode')], 'opencode.json'),
                ('claude-code', '2.1.318', [str(assets / 'claude' / 'claude')], '.mcp.json'),
                ('gemini-cli', '0.67.0', [str(node), str(assets / 'gemini' / 'gemini.js')], '.gemini/settings.json'),
            ]
            for client, version, executable, config_name in clients:
                project = root / client
                user_dir = project / 'user'
                project.mkdir()
                user_dir.mkdir()
                env = {
                    'PATH': os.environ['PATH'], 'HOME': str(user_dir), 'TMPDIR': str(project),
                    'XDG_CONFIG_HOME': str(user_dir / 'config'), 'XDG_CACHE_HOME': str(user_dir / 'cache'),
                    'XDG_DATA_HOME': str(user_dir / 'data'), 'XDG_STATE_HOME': str(user_dir / 'state'),
                    'NO_COLOR': '1', 'CI': '1', 'OPENCODE_DISABLE_AUTOUPDATE': '1',
                    'OPENCODE_DISABLE_MODELS_FETCH': '1', 'OPENCODE_DISABLE_DEFAULT_PLUGINS': '1',
                    'OPENCODE_DISABLE_LSP_DOWNLOAD': '1', 'DISABLE_AUTOUPDATER': '1',
                    'DISABLE_TELEMETRY': '1', 'GEMINI_CLI_TRUST_WORKSPACE': 'true',
                }
                config = run([str(node), '--input-type=module', '-e', generator, client, str(pp), str(pairing)],
                             cwd=repo, env=env)
                parsed = json.loads(config)
                key = 'mcp' if client == 'opencode' else 'mcpServers'
                if list(parsed[key]) != ['protopeek']:
                    raise RuntimeError(f'{client}: generated config did not contain exactly one server')
                config_path = (user_dir if client == 'gemini-cli' else project) / config_name
                config_path.parent.mkdir(parents=True, exist_ok=True)
                config_path.write_text(config, encoding='utf-8')
                if client == 'claude-code':
                    env['CLAUDE_CONFIG_DIR'] = str(user_dir / '.claude')
                    # Untrusted projects cannot approve themselves. Verify the default
                    # pending state, then explicitly approve only this test server in
                    # the disposable user's settings (not in the project).
                    pending = run([*executable, 'mcp', 'list'], cwd=project, env=env)
                    if not re.search(r'protopeek[^\n]*pending approval', pending, re.IGNORECASE):
                        raise RuntimeError('claude-code: expected project server to require approval')
                    settings = user_dir / '.claude' / 'settings.json'
                    settings.parent.mkdir(parents=True, exist_ok=True)
                    settings.write_text(json.dumps({'enabledMcpjsonServers': ['protopeek']}), encoding='utf-8')
                    print('PASS claude-code: project server required explicit isolated approval', flush=True)
                reported_version = run([*executable, '--version'], cwd=project, env=env)
                if not re.search(rf'(?<!\d){re.escape(version)}(?!\d)', reported_version):
                    raise RuntimeError(f'{client}: binary did not report the pinned version {version}')
                output = run([*executable, 'mcp', 'list'], cwd=project, env=env)
                status_lines = [line for line in output.splitlines() if 'protopeek' in line.lower() and connected(line)]
                if len(status_lines) != 1:
                    raise RuntimeError(f'{client}: expected the generated server to be connected: {output[-1000:]}')
                if client == 'claude-code':
                    details = run([*executable, 'mcp', 'get', 'protopeek'], cwd=project, env=env)
                    if not any(connected(line) for line in details.splitlines()):
                        raise RuntimeError(f'{client}: mcp get did not report a connected server')
                print(f'PASS {client} {version}: one generated local server connected; tool calls not tested', flush=True)
        finally:
            launcher.terminate()
            try:
                launcher.wait(timeout=5)
            except subprocess.TimeoutExpired:
                launcher.kill()
                launcher.wait(timeout=5)


if __name__ == '__main__':
    main()
