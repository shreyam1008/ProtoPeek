#!/bin/sh

set -eu

image=${1:-protopeek:dev}
expected_version=${2:-}
container_id=

if [ -z "$expected_version" ]; then
	echo "expected image version is required" >&2
	exit 2
fi

cleanup() {
	if [ -n "$container_id" ]; then
		docker rm -f "$container_id" >/dev/null 2>&1 || true
	fi
}
trap cleanup EXIT INT TERM

configured_user=$(docker image inspect --format '{{.Config.User}}' "$image")
if [ "$configured_user" != "protopeek" ]; then
	echo "scratch image user is $configured_user, want protopeek" >&2
	exit 1
fi

version_output=$(docker run --rm --entrypoint /bin/protopeek "$image" -version 2>&1)
expected_version_output="/bin/protopeek $expected_version"
if [ "$version_output" != "$expected_version_output" ]; then
	echo "container version output is '$version_output', want '$expected_version_output'" >&2
	exit 1
fi

container_id=$(docker run --detach --publish 127.0.0.1::8080 "$image")
host_port=$(docker port "$container_id" 8080/tcp | sed -n '1s/.*://p')
if [ -z "$host_port" ]; then
	echo "Docker did not publish the ProtoPeek port on host loopback" >&2
	exit 1
fi
base_url="http://127.0.0.1:$host_port/"

curl_status() {
	curl --silent --connect-timeout 1 --max-time 2 --output /dev/null --write-out '%{http_code}' "$@" "$base_url"
}

attempt=0
status=000
while [ "$attempt" -lt 100 ]; do
	status=$(curl_status || true)
	if [ "$status" = "200" ]; then
		break
	fi
	attempt=$((attempt + 1))
	sleep 0.1
done
if [ "$status" != "200" ]; then
	echo "loopback console returned HTTP $status, want 200" >&2
	docker logs "$container_id" >&2 || true
	exit 1
fi

host_status=$(curl_status -H 'Host: attacker.example')
if [ "$host_status" != "403" ]; then
	echo "DNS-rebinding Host returned HTTP $host_status, want 403" >&2
	exit 1
fi

origin_status=$(curl_status -H 'Origin: https://attacker.example')
if [ "$origin_status" != "403" ]; then
	echo "cross-origin request returned HTTP $origin_status, want 403" >&2
	exit 1
fi

echo "Docker smoke OK: non-root scratch image, loopback HTTP 200, hostile Host/Origin HTTP 403."
