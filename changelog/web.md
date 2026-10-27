# Web changelog

## 1.7.0 (2026-10-27)

- The site counts visits with Vercel Web Analytics, which sets no cookies. Each page view is sent with its path only, never the part of the address after a ? or #, where other sites add click and campaign codes.
- A new Privacy page says what the site counts, what it keeps in your browser, and what it sends elsewhere. The footer links to it.

## 1.6.1 (2026-10-27)

- The sitemap now lists every state map page and each State House and State Senate page, not only the home, How it works, FAQ and changelog pages.

## 1.6.0 (2026-10-27)

- The FAQ answers what fair means here, set beside equal, proportional and equitable, and its terms add Fair and Proportional.

## 1.5.0 (2026-10-27)

- The home page is less crowded: the second paragraph is shorter, How it works and the three questions share one row of links, and the note on Washington, D.C. and the territories now lives only in the FAQ.
- State labels on the national map no longer overlap. A label can move within its state to make room for a neighbor's, and a state with no room gets a callout. Labels are drawn above every state, so a neighbor no longer covers one.
- On a phone, the national map grows to hold its callout column instead of running into what follows it.
- Pointing at a state's label lights the state with it, and a state with keyboard focus stays lit when the pointer moves away.
- Every page's footer links to GitHub forms for asking a question or reporting a problem, and the FAQ points to the question form for anything it does not answer.

## 1.4.0 (2026-10-23)

- Addresses are now real paths, such as /CO, /CO/d/3, /how and /faq, instead of #/ links. Old #/ links still work and are rewritten to the path form when they open.
- Embedders that set only dataBase in STR_VIEWER_CONFIG stay in hash mode, so a host page's own address is never rewritten. Setting routing to path opts in to real paths.
- The home, How it works, FAQ and changelog pages are built ahead of time with their text and structured data (site, author, dataset, breadcrumb and FAQ markup, and the same for each state and chamber page), so search engines and link previews can read them without running the viewer.
- The site now publishes a sitemap, robots.txt, llms.txt and llms-full.txt, along with a favicon and a touch icon.
- State share pages open the viewer directly.
- The home page answers what gerrymandering is and how to stop it.
- The national questions list sits in the wide grid.

## 1.3.0 (2026-10-13)

- What happened in this state reports how many balancing moves only shortened the border, when the map's stats include the count.
- The balancing replay reads moves that leave the districts exactly as close to equal, including moves of blocks with no people.
- How it works, the FAQ and the page explainers describe island link lengths in borders and balancing as people first, then border.
- Letters that stand for numbers in the explanations (such as the balancing score's p, a and b) are set in italics.

## 1.2.1 (2026-10-12)

- The map before balancing now loads only when it is shown, so state chamber pages open faster.
- District colors are fixed from the first paint.

## 1.2.0 (2026-10-11)

- The viewer now shows State House and State Senate maps alongside the Federal House map, with the same cut-by-cut walkthrough and comparison.
- The map credit, cut ticks, district names and national page wording follow the chamber being shown.
- The Federal House map is still the default, and its links are unchanged.

## 1.1.0 (2026-10-11)

- feat(web): put FAQ first in the masthead and add a GitHub link before the credit

## 1.0.0 (2026-10-11)

- First release of the map viewer: every state's districts, the cut-by-cut walkthrough, address search, the How it works page with worked examples, and share links.
