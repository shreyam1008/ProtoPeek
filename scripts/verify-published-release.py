"""Explicit draft/public release verification; --install opts into native acceptance.

Public mode uses no GitHub credentials or download overrides. Draft mode consumes
workflow-downloaded assets and explicitly uses verified file URLs. No package
manager/vendor tools or account actions. Private prefixes are the default;
default-user-path testing is allowed only on ephemeral GitHub-hosted runners and
restores its changes. Requires Python3 and Go's read-only `version -m` command.
"""

import argparse
import errno
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import signal
import socket
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPO = "shreyam1008/ProtoPeek"
API = "https://api.github.com/repos/" + REPO
BASE = "https://github.com/" + REPO + "/releases/download/"
MAX_ASSET = 256 << 20
MAX_MEMBERS = 512
MAX_UNPACKED = 512 << 20
TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
NO_INPUT = object()


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def get(url, maximum, expected_size=None, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": "ProtoPeek-published-release-verifier", **(headers or {})})
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=30) as response:
        require(response.status == 200, "Unexpected HTTP status")
        if url.startswith("https://"):
            host = urllib.parse.urlsplit(response.url).hostname
            require(host in {"api.github.com", "github.com", "raw.githubusercontent.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}, "Unexpected download redirect authority")
        length = response.headers.get("Content-Length")
        if length:
            require(int(length) <= maximum, "Declared response exceeds its size bound")
        parts, size = [], 0
        while True:
            require(time.monotonic() - started < 180, "Download exceeded its time bound")
            chunk = response.read(min(1 << 20, maximum + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            require(size <= maximum, "Response exceeded its size bound")
            parts.append(chunk)
        require(expected_size is None or size == expected_size, "Release asset byte count differs from metadata")
        return b"".join(parts)


def public_json(url):
    return json.loads(get(url, 1 << 20))


def resolve_tag(tag):
    value = public_json(API + "/git/ref/tags/" + tag)["object"]
    for _ in range(4):
        if value["type"] == "commit":
            require(re.fullmatch("[a-f0-9]{40}", value["sha"]), "Invalid tag commit")
            return value["sha"]
        require(value["type"] == "tag", "Tag does not resolve to a commit")
        value = public_json(API + "/git/tags/" + value["sha"])["object"]
    raise ValueError("Annotated tag chain exceeds its bound")


def release(tag, expected_sha, output, metadata_path=None):
    require(TAG.fullmatch(tag), "Exact stable vMAJOR.MINOR.PATCH tag required")
    if metadata_path:
        require(metadata_path.is_file() and metadata_path.stat().st_size <= 1 << 20, "Draft metadata exceeds its bound")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
    else:
        metadata = public_json(API + "/releases/tags/" + tag)
    require(metadata["tag_name"] == tag and metadata["prerelease"] is False, "Release tag/type mismatch")
    require(metadata["draft"] is bool(metadata_path), "Release visibility does not match explicit draft/public mode")
    require(metadata_path or metadata["published_at"], "Release is not published stable")
    release_id = metadata.get("id")
    if metadata_path:
        require(type(release_id) is int and release_id > 0 and metadata.get("url") == API + "/releases/" + str(release_id), "Draft release API identity mismatch")
        asset_ids = [item.get("id") for item in metadata["assets"]]
        require(all(type(item) is int and item > 0 for item in asset_ids) and len(asset_ids) == len(set(asset_ids)), "Draft asset IDs are invalid or duplicated")
    sha = resolve_tag(tag)
    require(expected_sha is None or sha == expected_sha, "Published tag commit differs from explicit expected SHA")
    require(len(metadata["assets"]) <= 256, "Asset inventory exceeds its bound")
    names = [asset["name"] for asset in metadata["assets"]]
    require(len(names) == len(set(names)), "Duplicate asset names")
    if output:
        (output / (tag + "-metadata.json")).write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return {"tag": tag, "sha": sha, "draft": bool(metadata_path), "releaseId": release_id, "assets": {asset["name"]: asset for asset in metadata["assets"]}, "downloaded": []}


def asset_identity(value, name):
    require(name in value["assets"], "Missing release asset " + name)
    item = value["assets"][name]
    if value.get("draft"):
        require(type(value.get("releaseId")) is int and value["releaseId"] > 0, "Draft release identity missing")
        require(type(item.get("id")) is int and item["id"] > 0 and item.get("name") == name and item.get("url") == API + "/releases/assets/" + str(item["id"]), "Draft asset API identity mismatch")
        require(re.fullmatch(r"sha256:[a-f0-9]{64}", item.get("digest") or ""), "Draft asset digest missing or invalid")
    else:
        require(item["browser_download_url"] == BASE + value["tag"] + "/" + name, "Asset authority/name mismatch")
    size = item["size"]
    require(type(size) is int and 0 < size <= MAX_ASSET, "Invalid release asset size")
    return item


def asset(value, name, output):
    item = asset_identity(value, name)
    size = item["size"]
    require(not value.get("draft") or value.get("assetDirectory"), "Draft assets require authenticated local downloads")
    if value.get("assetDirectory"):
        local = Path(value["assetDirectory"]) / name
        require(local.is_file() and not local.is_symlink() and local.stat().st_size == size, "Draft file size/type mismatch: " + name)
        data = local.read_bytes()
        require(len(data) == size, "Draft asset changed while reading")
    else:
        data = get(item["browser_download_url"], size, size)
    sha = digest(data)
    require(not item.get("digest") or item["digest"] == "sha256:" + sha, "GitHub asset digest mismatch")
    if name != "checksums.txt" and value.get("checksums"):
        require(value["checksums"].get(name) == sha, "Release checksum mismatch: " + name)
    path = output / name
    with path.open("xb") as stream:
        stream.write(data)
    value["downloaded"].append({"name": name, "assetId": item.get("id"), "bytes": len(data), "sha256": sha})
    return data


def checksums(data):
    result = {}
    for line in data.decode("utf-8-sig").splitlines():
        match = re.fullmatch(r"([a-fA-F0-9]{64}) {2}([^/\\]+)", line)
        require(match and match[2] not in result, "Invalid/duplicate checksum entry")
        result[match[2]] = match[1].lower()
    return result


def member_name(name):
    path = PurePosixPath(name)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in name and ":" not in name, "Unsafe archive member")
    return str(path)


def inspect_archive(data, filename, value, output, goos, goarch, strict_clean):
    if filename.endswith(".zip"):
        archive = zipfile.ZipFile(io.BytesIO(data))
        entries = archive.infolist()
        require(all((item.external_attr >> 16) & 0o170000 != 0o120000 for item in entries), "Archive symlink refused")
        files = [(item.filename, item.file_size, lambda item=item: archive.open(item)) for item in entries if not item.is_dir()]
    else:
        archive = tarfile.open(fileobj=io.BytesIO(data), mode="r:*")
        entries = []
        expanded = 0
        for item in archive:
            entries.append(item)
            expanded += item.size
            require(len(entries) <= MAX_MEMBERS and expanded <= MAX_UNPACKED, "Archive member/expanded-byte bound exceeded")
        require(all(item.isfile() or item.isdir() for item in entries), "Archive link/special file refused")
        files = [(item.name, item.size, lambda item=item: archive.extractfile(item)) for item in entries if item.isfile()]
    require(len(entries) <= MAX_MEMBERS and sum(size for _, size, _ in files) <= MAX_UNPACKED, "Archive member/expanded-byte bound exceeded")
    normalized = [(member_name(name), size, read) for name, size, read in files]
    names = [name for name, _, _ in normalized]
    require(len(names) == len(set(names)), "Duplicate archive members")
    executable_names = {"protopeek.exe", "pp.exe"} if goos == "windows" else {"protopeek", "pp"}
    needed = executable_names | {"man/protopeek.1", "man/pp.1"}
    if strict_clean:
        needed |= {"THIRD_PARTY_NOTICES.md"} | {"third_party/licenses/" + name for name in ["go-capnp-MIT.txt", "zeropool-APACHE-2.0.txt", "quic-go-MIT.txt", "qpack-MIT.txt"]}
    if strict_clean and goos == "windows":
        needed |= {"aria2-notices/COPYING", "aria2-notices/README.md"}
    require(needed.issubset(names), "Archive lacks required binaries/manuals/notices/licenses")
    reference = output / (value["tag"] + "-reference")
    reference.mkdir()
    hashes, buildinfo = {}, {}
    for name, size, read in normalized:
        if name not in executable_names | {"man/protopeek.1", "man/pp.1"}:
            continue
        require(size <= MAX_ASSET, "Binary/manual exceeds its bound")
        with read() as stream:
            content = stream.read(size + 1)
        require(len(content) == size, "Archive member size mismatch")
        hashes[name] = digest(content)
        target = reference / Path(name).name
        target.write_bytes(content)
        if name.startswith("man/"):
            require(('"ProtoPeek ' + value["tag"][1:] + '"') in content.splitlines()[0].decode("utf-8"), "Packaged manual version differs from tag")
        else:
            target.chmod(0o755)
            info = subprocess.run(["go", "version", "-m", str(target)], capture_output=True, timeout=15, env={**os.environ, "GOTOOLCHAIN": "local", "GOWORK": "off", "GOENV": "off"}, check=True).stdout.decode("utf-8")
            require(re.search(r"main\.version=" + re.escape(value["tag"]) + r"(?=\s|[\"']|$)", info), "Executable linker version differs from tag")
            require("vcs.revision=" + value["sha"] in info, "Executable source revision differs from tag")
            require("GOOS=" + goos in info and "GOARCH=" + goarch in info, "Executable platform differs from archive")
            if strict_clean:
                require("vcs.modified=false" in info, "Target executable has modified source metadata")
            buildinfo[name] = info
    archive.close()
    value.update(archive=filename, archiveMembers=len(names), hashes=hashes, buildinfo=buildinfo)


def prepare(value, output, goos, goarch, archive_arch, strict_clean):
    suffix = ".zip" if goos == "windows" else ".tar.gz"
    release_os = "osx" if goos == "darwin" else goos
    name = "protopeek_" + value["tag"][1:] + "_" + release_os + "_" + archive_arch + suffix
    expected = checksums(asset(value, "checksums.txt", output))
    value["checksums"] = expected
    # Each tag gets its own directory, so both real releases retain their receipts.
    data = asset(value, name, output)
    require(expected.get(name) == digest(data), "Downloaded archive checksum mismatch")
    sbom_name = name + ".sbom.json"
    sbom = asset(value, sbom_name, output)
    require(expected.get(sbom_name) == digest(sbom) and isinstance(json.loads(sbom), dict), "SBOM checksum/JSON validation failed")
    inspect_archive(data, name, value, output, goos, goarch, strict_clean)
    value["archivePath"] = str(output / name)
    value["checksumPath"] = str(output / "checksums.txt")


def clean_environment():
    return {key: value for key, value in os.environ.items() if not key.upper().startswith("PROTOPEEK_") and key.upper() not in {"GH_TOKEN", "GITHUB_TOKEN"}}


def child_environment(profile, isolate_home=False):
    env = clean_environment()
    if isolate_home:
        home = profile / "home"
        home.mkdir(parents=True, exist_ok=True)
        env["HOME"] = str(home)
    for key, name in {"APPDATA": "appdata", "LOCALAPPDATA": "localappdata", "XDG_CONFIG_HOME": "config", "XDG_CACHE_HOME": "cache", "XDG_DATA_HOME": "data", "XDG_STATE_HOME": "state", "TEMP": "temp", "TMP": "temp", "TMPDIR": "temp"}.items():
        path = profile / name
        path.mkdir(parents=True, exist_ok=True)
        env[key] = str(path)
    env.update(NO_COLOR="1", TERM="dumb")
    return env


def windows_powershell_environment(env):
    # Python bypasses PowerShell7's normal native-child module-path cleanup.
    # Let WindowsPowerShell5 discover its own compatible built-in modules.
    return {key: value for key, value in env.items() if key.upper() != "PSMODULEPATH"}


def command(args, env, log):
    if Path(args[0]).name.lower() == "powershell.exe":
        env = windows_powershell_environment(env)
    with log.open("wb") as stream:
        process = subprocess.Popen(args, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=os.name != "nt")
        try:
            code = process.wait(timeout=240)
        except subprocess.TimeoutExpired:
            # Unix installers synchronously own curl/wget in this private group.
            # Signal before reaping its leader, so this PID cannot be reused.
            if os.name != "nt":
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name != "nt":
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
                process.wait(timeout=3)
            raise ValueError("Command exceeded its time bound; owned process stopped: " + log.name)
    require(log.stat().st_size <= 1 << 20, "Child output exceeded its evidence bound")
    require(code == 0, "Command failed; see " + log.name)
    return log.read_text(encoding="utf-8-sig", errors="replace")


def powershell_json(code, input_value=NO_INPUT):
    command = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + code
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command], input=None if input_value is NO_INPUT else json.dumps(input_value).encode("utf-8"), capture_output=True, timeout=20, check=True, env=windows_powershell_environment(os.environ))
    return json.loads(result.stdout.decode("utf-8-sig")) if result.stdout.strip() else None


def user_path():
    return powershell_json("[Environment]::GetEnvironmentVariable('Path','User') | ConvertTo-Json -Compress")


def install(installer, value, prefix, profile, label, output, windows, draft=False, default=False, man_dir=None):
    env = child_environment(profile)
    installer_env = clean_environment() if default else env.copy()
    man_dir = man_dir or prefix / "man"
    explicit_version = draft or not default
    if windows:
        before = user_path()
        args = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(installer)]
        if explicit_version:
            args += ["-Version", value["tag"]]
        if not default:
            args += ["-InstallDir", str(prefix), "-NoPathUpdate", "-NoShortcuts"]
        if draft:
            args += ["-DownloadUrl", Path(value["archivePath"]).as_uri(), "-ChecksumUrl", Path(value["checksumPath"]).as_uri()]
    else:
        if explicit_version:
            installer_env["PROTOPEEK_VERSION"] = value["tag"]
        if default:
            installer_env.pop("XDG_BIN_HOME", None)
            installer_env.pop("XDG_DATA_HOME", None)
        else:
            installer_env.update(PROTOPEEK_INSTALL_DIR=str(prefix), PROTOPEEK_MAN_DIR=str(man_dir))
        if draft:
            installer_env.update(PROTOPEEK_DOWNLOAD_URL=Path(value["archivePath"]).as_uri(), PROTOPEEK_CHECKSUM_URL=Path(value["checksumPath"]).as_uri())
        args = ["sh", str(installer)]
    command(args, installer_env, output / (label + "-installer.log"))
    if windows and not default:
        require(user_path() == before, "Installer changed the Windows user PATH")
    names = ["protopeek.exe", "pp.exe"] if windows else ["protopeek", "pp"]
    versions = {}
    for name in names:
        binary = prefix / name
        require(digest(binary.read_bytes()) == value["hashes"][name], "Installed executable differs from verified archive")
        text = command([str(binary), "-version"], env, output / (label + "-" + name + ".log"))
        require(re.search(r"(?<!\S)" + re.escape(value["tag"]) + r"(?!\S)", text), "CLI version differs from selected release")
        versions[name] = text.strip()
    marker = (prefix / ".protopeek-install").read_text(encoding="utf-8-sig")
    require(marker.strip() == "ProtoPeek " + value["hashes"][names[1]], "Owned alias marker mismatch")
    if not windows:
        for name in ("protopeek.1", "pp.1"):
            require(digest((man_dir / name).read_bytes()) == value["hashes"]["man/" + name], "Installed manpage differs from archive")
    return {"tag": value["tag"], "versions": versions, "verifiedInstalledHashes": {name: value["hashes"][name] for name in names}, "installerSource": "verified-file-URLs (draft only)" if draft else "anonymous-official-release-URLs", "versionSelection": "explicit-tag" if explicit_version else "latest-stable-resolver"}


def missing_default_directories(home, targets):
    missing = set()
    for target in targets:
        directory = target
        while directory != home:
            require(directory.resolve().is_relative_to(home), "Default directory escapes ephemeral runner home")
            if not directory.exists():
                missing.add(directory)
            directory = directory.parent
    return sorted(missing, key=lambda path: len(path.parts), reverse=True)


def remove_new_empty_directories(home, directories):
    retained = []
    for directory in sorted(directories, key=lambda path: len(path.parts), reverse=True):
        require(directory.resolve().is_relative_to(home) and directory != home, "Cleanup directory escapes ephemeral runner home")
        try:
            directory.rmdir()
        except FileNotFoundError:
            continue
        except OSError as error:
            if error.errno not in (errno.ENOTEMPTY, errno.EEXIST):
                raise
            retained.append(str(directory.relative_to(home)))
    return retained


def ephemeral_default(installer, value, output, windows, draft):
    runner_temp = os.environ.get("RUNNER_TEMP")
    require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted" and runner_temp and output.is_relative_to(Path(runner_temp).resolve()), "Default-path acceptance is restricted to an ephemeral GitHub-hosted runner sandbox")
    home = Path.home().resolve()
    original_path = user_path() if windows else None
    profiles = {path: digest(path.read_bytes()) if path.exists() else None for path in (home / ".profile", home / ".bashrc", home / ".zshrc")}
    if windows:
        root = (Path(os.environ["LOCALAPPDATA"]) / "Programs" / "ProtoPeek").resolve()
        prefix, man_dir = root / "bin", None
        programs = Path(powershell_json("[Environment]::GetFolderPath('Programs') | ConvertTo-Json -Compress"))
        shortcut_dir = programs / "ProtoPeek"
        shortcut = shortcut_dir / "ProtoPeek.lnk"
        require(not root.exists() and not shortcut_dir.exists(), "Default ProtoPeek installation/shortcut already exists; refusing overwrite")
        require(root.is_relative_to(home), "Default install escapes the ephemeral runner home")
        files = [prefix / name for name in ("protopeek.exe", "pp.exe", ".protopeek-install")] + [shortcut]
        directories = [prefix, root, shortcut_dir]
    else:
        prefix, man_dir = home / ".local/bin", home / ".local/share/man/man1"
        files = [prefix / name for name in ("protopeek", "pp", ".protopeek-install")] + [man_dir / name for name in ("protopeek.1", "pp.1")]
        require(all(not path.exists() and not path.is_symlink() for path in files), "Default ProtoPeek target exists; refusing overwrite")
        require(prefix.resolve().is_relative_to(home) and man_dir.resolve().is_relative_to(home), "Default install escapes the ephemeral runner home")
        directories = missing_default_directories(home, (prefix, man_dir))
    result = None
    try:
        result = install(installer, value, prefix, output / "default-version-profile", "ephemeral-default", output, windows, draft, True, man_dir)
        if windows:
            after = user_path() or ""
            require(any(os.path.normcase(os.path.normpath(item)) == os.path.normcase(str(prefix)) for item in after.split(";") if item), "Default installer did not expose its bin directory on user PATH")
            code = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:PROTOPEEK_VERIFY_SHORTCUT); @{target=$s.TargetPath;arguments=$s.Arguments} | ConvertTo-Json -Compress"
            env = clean_environment()
            env["PROTOPEEK_VERIFY_SHORTCUT"] = str(shortcut)
            raw = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", code], env=windows_powershell_environment(env), capture_output=True, timeout=20, check=True)
            link = json.loads(raw.stdout)
            require(Path(link["target"]).resolve() == (prefix / "protopeek.exe").resolve() and link["arguments"] == "-open-browser=true -port 8844", "Default shortcut target/launch arguments mismatch")
            result["defaultShortcut"] = {"targetMatchesInstalledBinary": True, "browserFlag": True, "port": 8844}
        else:
            require(all((digest(path.read_bytes()) if path.exists() else None) == before for path, before in profiles.items()), "Default Unix install changed a shell profile")
        return result
    finally:
        if windows:
            powershell_json("$value=[Console]::In.ReadToEnd() | ConvertFrom-Json; [Environment]::SetEnvironmentVariable('Path',$value,'User')", original_path)
            require(user_path() == original_path, "Ephemeral Windows user PATH restoration failed")
        for path in files:
            require(path.resolve().is_relative_to(home), "Cleanup target escapes ephemeral runner home")
            if path.exists():
                require(path.is_file() and not path.is_symlink(), "Unexpected default-install cleanup target")
                path.unlink()
        retained = remove_new_empty_directories(home, directories)
        if result is not None:
            result["cleanup"] = "Exact created files and newly created empty directories removed; Windows user PATH restored; no recursive home deletion."
            result["retainedNonemptyDirectories"] = retained


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and values.get("src"):
            self.paths.append(values["src"])
        if tag == "link" and values.get("rel") == "stylesheet":
            self.paths.append(values["href"])


def local_request(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            data = response.read((4 << 20) + 1)
            require(len(data) <= 4 << 20, "Local response exceeded its size bound")
            return response.status, response.headers.get("Content-Type", ""), data
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("Content-Type", ""), error.read(64 << 10)


def smoke(binary, value, profile, label, output, expected_catalog):
    env = child_environment(profile, isolate_home=True)
    log_path = output / (label + "-server.log")
    process, address = None, None
    with log_path.open("wb") as log:
        try:
            process = subprocess.Popen([str(binary), "-bind", "127.0.0.1", "-port", "0", "-open-browser=false"], env=env, stdout=log, stderr=subprocess.STDOUT)
            until = time.monotonic() + 20
            while time.monotonic() < until:
                require(process.poll() is None, "Owned ProtoPeek exited during startup")
                require(log_path.stat().st_size <= 1 << 20, "Startup log exceeded its bound")
                text = log_path.read_text(encoding="utf-8", errors="replace")
                match = re.search(r"http://127\.0\.0\.1:(\d+)", text)
                if match:
                    address = "http://127.0.0.1:" + match[1]
                    break
                time.sleep(0.1)
            require(address, "No owned loopback URL in startup banner")
            status, content_type, index = local_request(address + "/")
            require(status == 200 and "text/html" in content_type and b'id="root"' in index, "Embedded index unavailable")
            parser = Assets()
            parser.feed(index.decode("utf-8"))
            require(parser.paths, "Embedded index has no entry assets")
            assets = []
            for path in parser.paths:
                url = urllib.parse.urljoin(address + "/", path)
                require(urllib.parse.urlsplit(url).netloc == urllib.parse.urlsplit(address).netloc, "Embedded asset escapes owned origin")
                code, kind, data = local_request(url)
                require(code == 200 and data and "text/html" not in kind, "Embedded JS/CSS unavailable")
                require(("javascript" in kind if urllib.parse.urlsplit(url).path.endswith(".js") else "text/css" in kind), "Embedded entry asset MIME mismatch")
                assets.append({"path": path, "bytes": len(data), "sha256": digest(data), "contentType": kind})
            code, _, data = local_request(address + "/api/bootstrap")
            bootstrap = json.loads(data)
            require(code == 200 and bootstrap["version"] == value["tag"] and bootstrap["launcherMode"] is True, "Bootstrap release/launcher contract mismatch")
            code, _, data = local_request(address + "/api/extensions/catalog")
            catalog = json.loads(data)
            require(code == 200 and catalog["schemaVersion"] == 1 and catalog["extensions"] == expected_catalog, "Published catalog differs from exact tagged manifest")
            require(local_request(address + "/api/extensions/catalog?unexpected=1")[0] == 400, "Pure catalog query validation failed")
            require(local_request(address + "/", {"Host": "attacker.example"})[0] == 403, "Host guard failed")
            require(local_request(address + "/", {"Origin": "https://attacker.example"})[0] == 403, "Origin guard failed")
            require(process.poll() is None, "Owned ProtoPeek unexpectedly exited")
            return {"bootstrapVersion": bootstrap["version"], "catalogEntries": len(catalog["extensions"]), "assets": assets, "hostGuard": 403, "originGuard": 403}
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
            if address:
                parsed = urllib.parse.urlsplit(address)
                with socket.socket() as probe:
                    probe.settimeout(1)
                    require(probe.connect_ex((parsed.hostname, parsed.port)) != 0, "Owned loopback listener did not close")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--previous-tag")
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--ephemeral-default", action="store_true")
    parser.add_argument("--mode", choices=("draft", "public"), default="public")
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--asset-dir", type=Path)
    parser.add_argument("--draft-plan", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    require(TAG.fullmatch(args.tag) and re.fullmatch(r"[a-f0-9]{40}", args.sha), "Exact stable tag and full lowercase expected SHA required")
    goos = {"Windows": "windows", "Linux": "linux", "Darwin": "darwin"}[platform.system()]
    goarch, archive_arch = ("arm64", "arm64") if platform.machine().lower() in {"arm64", "aarch64"} else ("amd64", "x86_64")
    require(platform.machine().lower() in {"arm64", "aarch64", "amd64", "x86_64"}, "Unsupported native acceptance architecture")
    if args.draft_plan:
        value = release(args.tag, args.sha, None, args.draft_plan)
        release_os = "osx" if goos == "darwin" else goos
        archive = "protopeek_" + args.tag[1:] + "_" + release_os + "_" + archive_arch + (".zip" if goos == "windows" else ".tar.gz")
        names = [archive, archive + ".sbom.json", "checksums.txt", "install.sh", "install.ps1", "aria2-1.37.0-companion-sources.tar.gz"]
        total = 0
        for name in names:
            item = asset_identity(value, name)
            total += item["size"]
        require(total <= 512 << 20, "Draft download plan exceeds its aggregate bound")
        print(json.dumps({"releaseId": value["releaseId"], "assets": [{"id": value["assets"][name]["id"], "name": name, "url": value["assets"][name]["url"], "size": value["assets"][name]["size"], "digest": value["assets"][name]["digest"]} for name in names]}))
        return 0
    require(not args.install or args.previous_tag and TAG.fullmatch(args.previous_tag), "Published previous tag required for install/upgrade acceptance")
    require(not args.ephemeral_default or args.install, "Default-path acceptance requires --install")
    require(args.output, "Explicit fresh --output directory required")
    require((args.metadata and args.asset_dir) if args.mode == "draft" else not (args.metadata or args.asset_dir), "Draft metadata/assets are required only in explicit draft mode")
    output = args.output.resolve()
    require(output.parent.exists() and output != Path(output.anchor), "Output parent must exist; root output refused")
    output.mkdir(exist_ok=False)
    report = {"state": "failed", "tag": args.tag, "expectedSHA": args.sha, "mode": args.mode, "install": args.install, "anonymousTargetDownloads": args.mode == "public"}
    try:
        current_dir = output / "current"
        current_dir.mkdir()
        current = release(args.tag, args.sha, output, args.metadata)
        if args.mode == "draft":
            current["assetDirectory"] = str(args.asset_dir.resolve())
        prepare(current, current_dir, goos, goarch, archive_arch, True)
        report.update(platform=goos, architecture=goarch, current=current)
        installer_name = "install.ps1" if goos == "windows" else "install.sh"
        for script in ("install.sh", "install.ps1"):
            installer_bytes = asset(current, script, current_dir)
            source_url = "https://raw.githubusercontent.com/" + REPO + "/" + current["sha"] + "/" + script
            require(installer_bytes == get(source_url, 1 << 20), "Release installer differs from its exact tagged source")
        asset(current, "aria2-1.37.0-companion-sources.tar.gz", current_dir)
        if args.install:
            require(args.previous_tag != args.tag, "Upgrade source and target must differ")
            prior_dir = output / "previous"
            prior_dir.mkdir()
            previous = release(args.previous_tag, None, output)
            prepare(previous, prior_dir, goos, goarch, archive_arch, False)
            report["previous"] = previous
            manifest = public_json("https://raw.githubusercontent.com/" + REPO + "/" + current["sha"] + "/web/src/console/extension-manifest.json")
            expected_catalog = [{"id": item["id"], "capability": item["capability"]} for item in manifest]
            installer = current_dir / installer_name
            fresh, upgrade = output / "fresh-install", output / "upgrade-install"
            report["fresh"] = install(installer, current, fresh, output / "fresh-profile", "fresh", output, goos == "windows", args.mode == "draft")
            report["oldInstalled"] = install(installer, previous, upgrade, output / "upgrade-profile", "old", output, goos == "windows", args.mode == "draft")
            report["upgraded"] = install(installer, current, upgrade, output / "upgrade-profile", "upgrade", output, goos == "windows", args.mode == "draft")
            binary = "protopeek.exe" if goos == "windows" else "protopeek"
            report["freshHTTP"] = smoke(fresh / binary, current, output / "fresh-profile", "fresh", output, expected_catalog)
            report["upgradeHTTP"] = smoke(upgrade / binary, current, output / "upgrade-profile", "upgrade", output, expected_catalog)
            if args.ephemeral_default:
                report["ephemeralDefault"] = ephemeral_default(installer, current, output, goos == "windows", args.mode == "draft")
            report["cleanup"] = "Both owned children stopped and loopback listeners closed; only the private evidence/install sandbox is retained."
        report["state"] = "pass"
        return 0
    except Exception as error:
        report["error"] = type(error).__name__ + ": " + str(error)
        return 1
    finally:
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"state": report["state"], "tag": args.tag, "platform": report.get("platform"), "report": str(output / "report.json"), "error": report.get("error")}))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
