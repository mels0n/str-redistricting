/** The name the checker gives in robots.txt rules and in its User-Agent. */
export const CHECKER_NAME = 'FairMapsBadgeCheck';

interface Rule {
  allow: boolean;
  pattern: string;
}

/** Turns a robots.txt path rule (with `*` and a closing `$`) into a test of a path. */
function matcher(pattern: string): RegExp {
  const end = pattern.endsWith('$');
  const body = (end ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*');
  return new RegExp(`^${body}${end ? '$' : ''}`);
}

/**
 * Whether robots.txt lets the checker fetch `path`. The group that names FairMapsBadgeCheck is used when there is one, otherwise
 * the `*` group; within it the longest matching rule wins and Allow wins a tie. An empty file, no matching group or no matching
 * rule allows the fetch.
 */
export function robotsAllows(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let inAgents = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!inAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      inAgents = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      inAgents = false;
      if (value !== '') current.rules.push({ allow: field === 'allow', pattern: value });
    } else {
      inAgents = false;
    }
  }
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && a !== '' && CHECKER_NAME.toLowerCase().includes(a)));
  const chosen = named.length > 0 ? named : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    if (!matcher(rule.pattern).test(path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best === null || best.allow;
}
