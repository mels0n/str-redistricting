import { describe, expect, it } from 'vitest';
import { fetchPublic, isPublicAddress, isPublicHostname, parsePublicHttpsUrl, SsrfError, type Transport, type TransportResponse } from '../../../src/server/shared/ssrf/index.js';

describe('isPublicAddress', () => {
  it('refuses private, loopback, link-local, shared, reserved and multicast IPv4', () => {
    for (const ip of ['0.0.0.0', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.1.2.3', '169.254.169.254', '169.254.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.19.0.1', '192.88.99.1', '198.51.100.1', '203.0.113.9', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it('accepts ordinary public IPv4, including the edges next to private blocks', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '192.169.0.1', '203.0.114.1']) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it('refuses loopback, unspecified, unique-local, link-local, multicast and documentation IPv6', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '2001:db8::1', '2001::1', '2002:7f00:1::1', 'fe80::1%eth0']) expect(isPublicAddress(ip), ip).toBe(false);
  });
  it('refuses IPv4-mapped and NAT64 forms, in every spelling', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:7f00:1', '::ffff:8.8.8.8', '64:ff9b::7f00:1', '64:ff9b::a00:1', '::127.0.0.1']) expect(isPublicAddress(ip), ip).toBe(false);
  });
  it('accepts global unicast IPv6', () => {
    for (const ip of ['2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '2001:4860:4860::8888']) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it('refuses anything that is not an address', () => {
    for (const ip of ['', 'example.com', '1.2.3', '1.2.3.4.5', '999.1.1.1', 'localhost']) expect(isPublicAddress(ip), ip).toBe(false);
  });
});

describe('parsePublicHttpsUrl', () => {
  it('accepts a plain https site, with or without the default port', () => {
    expect(parsePublicHttpsUrl('https://example.com/a?b=1')?.href).toBe('https://example.com/a?b=1');
    expect(parsePublicHttpsUrl('https://www.example.org:443/')?.hostname).toBe('www.example.org');
    expect(parsePublicHttpsUrl('https://EXAMPLE.com')?.hostname).toBe('example.com');
  });
  it('refuses other schemes', () => {
    for (const u of ['http://example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://example.com/']) expect(parsePublicHttpsUrl(u), u).toBeNull();
  });
  it('refuses a user name or password in the address', () => {
    expect(parsePublicHttpsUrl('https://user@example.com/')).toBeNull();
    expect(parsePublicHttpsUrl('https://user:pw@example.com/')).toBeNull();
    expect(parsePublicHttpsUrl('https://example.com@evil.org/')).toBeNull();
  });
  it('refuses ports other than 443', () => {
    for (const u of ['https://example.com:8443/', 'https://example.com:80/', 'https://example.com:22/', 'https://example.com:444/']) expect(parsePublicHttpsUrl(u), u).toBeNull();
  });
  it('refuses IP literals in every notation', () => {
    for (const u of ['https://127.0.0.1/', 'https://8.8.8.8/', 'https://[::1]/', 'https://[2606:4700:4700::1111]/', 'https://[::ffff:127.0.0.1]/', 'https://2130706433/', 'https://0x7f.0.0.1/', 'https://0177.0.0.1/', 'https://127.1/', 'https://169.254.169.254/latest/meta-data/']) expect(parsePublicHttpsUrl(u), u).toBeNull();
  });
  it('refuses local and internal names', () => {
    for (const u of ['https://localhost/', 'https://app.localhost/', 'https://printer.local/', 'https://db.internal/', 'https://router.lan/', 'https://nas.home/', 'https://intranet/', 'https://host/', 'https://a.b.corp/', 'https://x.home.arpa/', 'https://example.test/', 'https://x.localdomain/', 'https://example.com./']) expect(parsePublicHttpsUrl(u), u).toBeNull();
  });
  it('refuses text that is not an address', () => {
    for (const u of ['', 'example.com', 'https://', '//example.com', 'https://exa mple.com/']) expect(parsePublicHttpsUrl(u), u).toBeNull();
  });
  it('knows a public host name from the rest', () => {
    expect(isPublicHostname('example.com')).toBe(true);
    expect(isPublicHostname('xn--bcher-kva.org')).toBe(true);
    expect(isPublicHostname('1.2.3.4')).toBe(false);
    expect(isPublicHostname('a_b.example.com')).toBe(false);
  });
});

function fake(map: Record<string, string[]>, responses: Record<string, TransportResponse>): { calls: { url: string; address: string; headers: Record<string, string> }[]; opts: { resolve: (h: string) => Promise<string[]>; transport: Transport; userAgent: string } } {
  const calls: { url: string; address: string; headers: Record<string, string> }[] = [];
  return {
    calls,
    opts: {
      userAgent: 'TestAgent',
      resolve: async (h) => {
        const a = map[h];
        if (!a) throw new Error('nxdomain');
        return a;
      },
      transport: async (r) => {
        calls.push({ url: r.url.href, address: r.address, headers: r.headers });
        const res = responses[r.url.href];
        if (!res) throw new SsrfError('network');
        return res;
      },
    },
  };
}
const ok = (body: string, contentType = 'text/html'): TransportResponse => ({ status: 200, location: null, contentType, body });
const redirect = (location: string, status = 302): TransportResponse => ({ status, location, contentType: null, body: '' });

describe('fetchPublic', () => {
  it('connects to the address it checked, sends no cookies, and returns the page', async () => {
    const f = fake({ 'example.com': ['93.184.216.34'] }, { 'https://example.com/': ok('<p>hi</p>') });
    const page = await fetchPublic('https://example.com/', f.opts);
    expect(page).toEqual({ status: 200, url: 'https://example.com/', contentType: 'text/html', body: '<p>hi</p>' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.address).toBe('93.184.216.34');
    expect(Object.keys(f.calls[0]!.headers).sort()).toEqual(['accept', 'accept-encoding', 'user-agent']);
    expect(f.calls[0]!.headers['user-agent']).toBe('TestAgent');
  });

  it('refuses a name that resolves to a private address, and never connects', async () => {
    for (const bad of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:7f00:1', 'fd00::1', '100.64.0.9']) {
      const f = fake({ 'example.com': [bad] }, { 'https://example.com/': ok('x') });
      await expect(fetchPublic('https://example.com/', f.opts), bad).rejects.toMatchObject({ code: 'private-address' });
      expect(f.calls).toHaveLength(0);
    }
  });

  it('refuses a name when ANY of its addresses is private (round-robin rebinding)', async () => {
    const f = fake({ 'example.com': ['93.184.216.34', '127.0.0.1'] }, { 'https://example.com/': ok('x') });
    await expect(fetchPublic('https://example.com/', f.opts)).rejects.toMatchObject({ code: 'private-address' });
    expect(f.calls).toHaveLength(0);
  });

  it('refuses a name that does not resolve', async () => {
    const f = fake({}, {});
    await expect(fetchPublic('https://nowhere.example.com/', f.opts)).rejects.toMatchObject({ code: 'dns' });
  });

  it('refuses a bad address before any lookup', async () => {
    let looked = false;
    const f = fake({}, {});
    f.opts.resolve = async () => {
      looked = true;
      return ['93.184.216.34'];
    };
    for (const u of ['http://example.com/', 'https://example.com:8443/', 'https://user@example.com/', 'https://127.0.0.1/', 'https://localhost/']) {
      await expect(fetchPublic(u, f.opts), u).rejects.toMatchObject({ code: 'bad-url' });
    }
    expect(looked).toBe(false);
  });

  it('follows redirects, checking every hop', async () => {
    const f = fake({ 'a.example.com': ['93.184.216.34'], 'b.example.com': ['93.184.216.35'] }, { 'https://a.example.com/': redirect('https://b.example.com/x'), 'https://b.example.com/x': redirect('/y', 301), 'https://b.example.com/y': ok('done') });
    const page = await fetchPublic('https://a.example.com/', f.opts);
    expect(page.url).toBe('https://b.example.com/y');
    expect(f.calls.map((c) => c.address)).toEqual(['93.184.216.34', '93.184.216.35', '93.184.216.35']);
  });

  it('refuses a redirect to a private host, a bare IP, another scheme or another port', async () => {
    for (const target of ['https://internal.example.com/', 'https://127.0.0.1/', 'http://b.example.com/', 'https://b.example.com:8443/', 'file:///etc/passwd', 'https://169.254.169.254/latest/meta-data/']) {
      const f = fake({ 'a.example.com': ['93.184.216.34'], 'internal.example.com': ['10.0.0.5'], 'b.example.com': ['93.184.216.35'] }, { 'https://a.example.com/': redirect(target), 'https://b.example.com/': ok('x') });
      await expect(fetchPublic('https://a.example.com/', f.opts), target).rejects.toBeInstanceOf(SsrfError);
      expect(f.calls.map((c) => c.url)).toEqual(['https://a.example.com/']);
    }
  });

  it('connects to an IPv4 address before an IPv6 one when a name has both', async () => {
    const f = fake({ 'example.com': ['2606:4700:4700::1111', '93.184.216.34'] }, { 'https://example.com/': ok('x') });
    await fetchPublic('https://example.com/', f.opts);
    expect(f.calls[0]!.address).toBe('93.184.216.34');
    const g = fake({ 'example.com': ['2606:4700:4700::1111'] }, { 'https://example.com/': ok('x') });
    await fetchPublic('https://example.com/', g.opts);
    expect(g.calls[0]!.address).toBe('2606:4700:4700::1111');
  });

  it('gives up with a timeout when the name server never answers', async () => {
    const f = fake({}, {});
    f.opts.resolve = () => new Promise(() => undefined);
    const started = Date.now();
    await expect(fetchPublic('https://example.com/', { ...f.opts, timeoutMs: 40 })).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(f.calls).toHaveLength(0);
  });

  it('stops after three redirects', async () => {
    const hosts = { 'a.example.com': ['93.184.216.34'] };
    const f = fake(hosts, { 'https://a.example.com/': redirect('/1'), 'https://a.example.com/1': redirect('/2'), 'https://a.example.com/2': redirect('/3'), 'https://a.example.com/3': redirect('/4'), 'https://a.example.com/4': ok('late') });
    await expect(fetchPublic('https://a.example.com/', f.opts)).rejects.toMatchObject({ code: 'redirects' });
    expect(f.calls).toHaveLength(4);
    const g = fake(hosts, { 'https://a.example.com/': redirect('/1'), 'https://a.example.com/1': redirect('/2'), 'https://a.example.com/2': redirect('/3'), 'https://a.example.com/3': ok('in time') });
    expect((await fetchPublic('https://a.example.com/', g.opts)).body).toBe('in time');
  });
});
