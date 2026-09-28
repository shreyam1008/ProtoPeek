import type { LocalNetworkCapabilities, LocalNetworkInterface } from '../../console/local-network';
import {
  array,
  contractLimits,
  exactKeys,
  formatIPv4,
  integer,
  normalizeStringArray,
  object,
  parseIPv4Address,
  parseIPv4CIDR,
  privateIPv4,
  string,
  timestamp,
} from '../../console/local-network-values';

export type LocalNetworkDevice = {
  readonly address: string;
  readonly interfaceIndex: number;
  readonly interfaceName: string;
  readonly mac: string;
  readonly hostname: string;
  readonly kind: 'self' | 'neighbor';
  readonly state: 'local' | 'cached';
  readonly source: 'local-interface' | 'os-neighbor-cache';
};

export type LocalNetworkInventory = {
  readonly observedAt: string;
  readonly status: 'available' | 'partial' | 'unavailable';
  readonly source: 'os-neighbor-cache';
  readonly defaultInterfaceIndex: number;
  readonly defaultGateway: string;
  readonly devices: readonly LocalNetworkDevice[];
  readonly warnings: readonly string[];
};

export function defaultLocalNetworkInterface(capabilities: LocalNetworkCapabilities) {
  const routed = capabilities.interfaces.find(
    (item) => item.index === capabilities.inventory?.defaultInterfaceIndex
  );
  return (
    routed ??
    capabilities.interfaces.find(
      (item) =>
        !/tailscale|tun\d|tap\d|utun|vpn|virtual|vethernet|docker|bridge|vbox|vmnet|wsl/i.test(
          item.name
        )
    ) ??
    capabilities.interfaces[0]
  );
}

export function localNetworkDevicesForInterface(
  inventory: LocalNetworkInventory,
  network: LocalNetworkInterface
) {
  const cidr = parseIPv4CIDR(network.interfaceCidr, 'Available network');
  return inventory.devices.filter((device) => {
    const address = parseIPv4Address(device.address, 'Known device address');
    return (
      device.interfaceIndex === network.index &&
      address >= cidr.network &&
      address < cidr.network + 2 ** (32 - cidr.prefix)
    );
  });
}

export function isAddressInLocalNetworkScope(address: string, scope: string) {
  const cidr = parseIPv4CIDR(scope, 'Network scope');
  const parsed = parseIPv4Address(address, 'Device address');
  return parsed >= cidr.network && parsed < cidr.network + 2 ** (32 - cidr.prefix);
}

export function normalizeLocalNetworkInventory(
  value: unknown,
  interfaces: readonly LocalNetworkInterface[]
): LocalNetworkInventory {
  const label = 'Network capabilities.inventory';
  const input = object(value, label);
  exactKeys(
    input,
    [
      'observedAt',
      'status',
      'source',
      'defaultInterfaceIndex',
      'defaultGateway',
      'devices',
      'warnings',
    ],
    label
  );
  if (
    input.status !== 'available' &&
    input.status !== 'partial' &&
    input.status !== 'unavailable'
  ) {
    throw new Error(`${label}.status is unsupported.`);
  }
  if (input.source !== 'os-neighbor-cache') throw new Error(`${label}.source is unsupported.`);
  const defaultInterfaceIndex = integer(
    input.defaultInterfaceIndex,
    `${label}.defaultInterfaceIndex`,
    0,
    1_000_000
  );
  if (
    defaultInterfaceIndex !== 0 &&
    !interfaces.some((item) => item.index === defaultInterfaceIndex)
  ) {
    throw new Error(`${label}.defaultInterfaceIndex must refer to an available network.`);
  }
  const defaultGateway = string(input.defaultGateway, `${label}.defaultGateway`, 15);
  if (
    defaultGateway &&
    (!defaultInterfaceIndex ||
      !privateIPv4(parseIPv4Address(defaultGateway, `${label}.defaultGateway`)))
  ) {
    throw new Error(`${label}.defaultGateway must be a private IPv4 address on a known route.`);
  }
  const devices = array(input.devices, `${label}.devices`, 256).map(
    (entry, index): LocalNetworkDevice => {
      const deviceLabel = `${label}.devices[${index}]`;
      const device = object(entry, deviceLabel);
      exactKeys(
        device,
        [
          'address',
          'interfaceIndex',
          'interfaceName',
          'mac',
          'hostname',
          'kind',
          'state',
          'source',
        ],
        deviceLabel
      );
      const address = parseIPv4Address(device.address, `${deviceLabel}.address`);
      const interfaceIndex = integer(
        device.interfaceIndex,
        `${deviceLabel}.interfaceIndex`,
        1,
        1_000_000
      );
      const iface = interfaces.find((item) => {
        if (item.index !== interfaceIndex) return false;
        const prefix = parseIPv4CIDR(item.interfaceCidr, `${deviceLabel}.network`);
        return address >= prefix.network && address < prefix.network + 2 ** (32 - prefix.prefix);
      });
      if (!iface || device.interfaceName !== iface.name || !privateIPv4(address)) {
        throw new Error(`${deviceLabel} must belong to an available private network.`);
      }
      const hostname = string(device.hostname, `${deviceLabel}.hostname`, 253);
      const mac = string(device.mac, `${deviceLabel}.mac`, 17);
      if (mac && !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
        throw new Error(`${deviceLabel}.mac must be a canonical MAC address.`);
      }
      if (device.kind === 'self') {
        if (
          device.state !== 'local' ||
          device.source !== 'local-interface' ||
          !interfaces.some(
            (item) => item.index === interfaceIndex && item.address === device.address
          )
        ) {
          throw new Error(`${deviceLabel} must match a local interface address.`);
        }
        return {
          address: formatIPv4(address),
          interfaceIndex,
          interfaceName: iface.name,
          mac,
          hostname,
          kind: 'self',
          state: 'local',
          source: 'local-interface',
        };
      }
      if (
        device.kind !== 'neighbor' ||
        device.state !== 'cached' ||
        device.source !== 'os-neighbor-cache' ||
        !mac ||
        hostname
      ) {
        throw new Error(
          `${deviceLabel} must contain cached neighbor evidence without an invented hostname.`
        );
      }
      return {
        address: formatIPv4(address),
        interfaceIndex,
        interfaceName: iface.name,
        mac,
        hostname: '',
        kind: 'neighbor',
        state: 'cached',
        source: 'os-neighbor-cache',
      };
    }
  );
  if (
    new Set(devices.map((device) => `${device.interfaceIndex}:${device.address}`)).size !==
    devices.length
  ) {
    throw new Error(`${label}.devices contains duplicates.`);
  }
  return {
    observedAt: timestamp(input.observedAt, `${label}.observedAt`),
    status: input.status,
    source: 'os-neighbor-cache',
    defaultInterfaceIndex,
    defaultGateway,
    devices,
    warnings: normalizeStringArray(input.warnings, `${label}.warnings`, contractLimits.maxWarnings),
  };
}
