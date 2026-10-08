import { clear, h } from '../../shared';
import { loadRuleExamples } from '../../entities/rule-example';
import { createRuleDemo, type RuleDemo } from '../../widgets/rule-demo';

/** An empty place for one case's panel; filled when its "The exact rule" expander is first opened. */
export function ruleSlot(caseId: string): HTMLElement {
  return h('div', { class: 'strv-rule-slot', 'data-case': caseId });
}

interface Entry {
  demo: RuleDemo;
  seen: boolean;
  /** Whether it is meant to be on screen and playing now. */
  running: boolean;
  /** Whether to play when it next comes into view: false once it has finished or the visitor paused it. */
  resume: boolean;
}

interface Wired {
  destroy(): void;
}
const wired = new WeakMap<HTMLDetailsElement, Wired>();

/**
 * Fills an expander's slots the first time it opens, from the one shared fetch of the examples file, and
 * plays the panels only while the expander is open and the panel is on screen.
 */
export function wireExact(details: HTMLDetailsElement): void {
  const demos: Entry[] = [];
  const status = h('p', { class: 'strv-rule-demo__status', role: 'status' });
  // Opening starts the load once; after a failure only the Try again button asks again.
  let started = false;
  let alive = true;
  let observer: IntersectionObserver | null = null;

  const settle = (): void => {
    for (const d of demos) {
      const want = details.open && d.seen;
      if (want === d.running) continue;
      d.running = want;
      if (want) {
        if (d.resume) d.demo.play();
      } else {
        d.resume = d.demo.playing;
        d.demo.pause();
      }
    }
  };

  async function fill(): Promise<void> {
    const slots = [...details.querySelectorAll<HTMLElement>('[data-case]')];
    if (!slots.length) return;
    started = true;
    clear(status);
    status.append('Loading the animated examples…');
    slots[0]!.before(status);
    try {
      const cases = await loadRuleExamples();
      if (!alive) return;
      // Build every panel before showing any, so a panel that fails leaves no half-filled set behind for Try again.
      const built: [HTMLElement, RuleDemo][] = [];
      try {
        for (const slot of slots) {
          const c = cases.get(slot.dataset.case ?? '');
          if (c) built.push([slot, createRuleDemo(c)]);
        }
      } catch (err) {
        for (const [, demo] of built) demo.destroy();
        throw err;
      }
      status.remove();
      for (const [slot, demo] of built) {
        slot.append(demo.el);
        // Without IntersectionObserver (old browsers, jsdom) a panel counts as in view.
        const entry: Entry = { demo, seen: observer === null, running: false, resume: true };
        demos.push(entry);
        observer?.observe(demo.el);
        elToEntry.set(demo.el, entry);
      }
      settle();
    } catch {
      if (!alive) return;
      clear(status);
      status.append('Could not load the examples', ' ', h('button', { type: 'button', class: 'strv-button', onclick: () => void fill() }, 'Try again'));
    }
  }

  const elToEntry = new WeakMap<Element, Entry>();
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const d = elToEntry.get(e.target);
        if (d) d.seen = e.isIntersecting;
      }
      settle();
    });
  }

  details.addEventListener('toggle', () => {
    if (details.open && !started) void fill();
    else settle();
  });

  wired.set(details, {
    destroy() {
      alive = false;
      observer?.disconnect();
      for (const d of demos) d.demo.destroy();
    },
  });
}

/** Stops every panel under `root`; the page calls this when it goes away. */
export function destroyExact(root: ParentNode): void {
  for (const d of root.querySelectorAll<HTMLDetailsElement>('details.strv-how__more')) wired.get(d)?.destroy();
}
