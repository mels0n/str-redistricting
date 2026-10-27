const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

export interface TurnstileHandlers {
  onToken: (token: string) => void;
  /** The token expired or the widget failed: the form must not send the old one. */
  onClear: () => void;
}

export interface TurnstileHandle {
  /** Asks for a fresh check; a token is single use. */
  reset(): void;
  remove(): void;
}

let loading: Promise<TurnstileApi> | null = null;

const present = (): TurnstileApi | undefined => (globalThis as { turnstile?: TurnstileApi }).turnstile;

/** Adds Cloudflare's script the first time it is needed, which is when a sign-on form opens, never at page load. */
function loadApi(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const ready = present();
    if (ready) {
      resolve(ready);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const api = present();
      if (api) resolve(api);
      else {
        loading = null;
        reject(new Error('turnstile missing'));
      }
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('turnstile failed to load'));
    };
    document.head.append(script);
  });
  return loading;
}

/** Renders the Managed widget into `el`. Rejects if Cloudflare's script cannot load. */
export async function mountTurnstile(el: HTMLElement, siteKey: string, handlers: TurnstileHandlers): Promise<TurnstileHandle> {
  const api = await loadApi();
  const id = api.render(el, {
    sitekey: siteKey,
    callback: (token: string) => handlers.onToken(token),
    'expired-callback': () => handlers.onClear(),
    'error-callback': () => handlers.onClear(),
  });
  return { reset: () => api.reset(id), remove: () => api.remove(id) };
}
