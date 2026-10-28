/** The legislative bodies a representative can sit in. */
export type Office = 'us-house' | 'us-senate' | 'state-house' | 'state-senate';

/** `CO:state-house:012`. Mirrors the publisher's key (see the parity test). */
export function districtKey(state: string, office: Office, code: string): string {
  return `${state}:${office}:${code}`;
}
