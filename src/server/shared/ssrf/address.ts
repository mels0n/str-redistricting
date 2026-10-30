import { isIP } from 'node:net';

/** The four numbers of a dotted IPv4 address, or null. */
export function ipv4Parts(ip: string): [number, number, number, number] | null {
  if (isIP(ip) !== 4) return null;
  const p = ip.split('.').map(Number);
  return [p[0]!, p[1]!, p[2]!, p[3]!];
}

/** True for an IPv4 address that is routable on the public internet. Everything reserved, private, shared, link-local, loopback, documentation, benchmarking or multicast is false. */
export function isPublicIPv4(ip: string): boolean {
  const o = ipv4Parts(ip);
  if (!o) return false;
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, including the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/** The eight 16-bit groups of an IPv6 address (an embedded dotted IPv4 tail is folded into two groups), or null. */
export function ipv6Groups(ip: string): number[] | null {
  if (isIP(ip) !== 6 || ip.includes('%')) return null;
  let text = ip;
  if (text.includes('.')) {
    const colon = text.lastIndexOf(':');
    const v4 = ipv4Parts(text.slice(colon + 1));
    if (!v4) return null;
    text = `${text.slice(0, colon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] === '' ? [] : halves[0]!.split(':');
  const right = halves.length === 1 || halves[1] === '' ? [] : halves[1]!.split(':');
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array<string>(Math.max(0, fill)).fill('0'), ...right].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * True for an IPv6 address inside global unicast space (2000::/3) and outside the blocks inside it that are not ordinary hosts
 * (2001::/23, documentation, 6to4). Everything else is false by default: loopback, unspecified, unique-local, link-local, multicast,
 * IPv4-mapped and NAT64 forms (which could reach a private IPv4 address).
 */
export function isPublicIPv6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return false;
  const [g0, g1] = [g[0]!, g[1]!];
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && g1 < 0x200) return false;
  if (g0 === 0x2001 && g1 === 0x0db8) return false;
  if (g0 === 0x2002) return false;
  if (g0 === 0x3fff && g1 < 0x1000) return false;
  return true;
}

/** True only for an address that is safe to connect to from the server. Anything that is not an IP address is false. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  return kind === 4 ? isPublicIPv4(ip) : kind === 6 ? isPublicIPv6(ip) : false;
}
