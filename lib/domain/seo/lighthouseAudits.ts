/**
 * What Marlo knows about the Lighthouse audits that can become findings: which Lighthouse category
 * each belongs to, and for each one what is wrong, how to fix it and how to check the fix.
 *
 * Lighthouse finding ids are `lighthouse-<device>-<auditId>`, so the set of audits is open-ended. The
 * category is read from the finding's own evidence when the audit recorded it (`lighthouseCategory`),
 * else from this table. An audit with neither is "unknown": it gets neutral wording that claims
 * nothing about speed, accessibility or anything else.
 */

export const LIGHTHOUSE_CATEGORIES = ["accessibility", "performance", "best-practices", "seo"] as const;
export type LighthouseCategory = (typeof LIGHTHOUSE_CATEGORIES)[number];

export type LighthouseGuide = {
  category: LighthouseCategory;
  /** Short action-led title for the recommendation. */
  title: string;
  /** What is wrong, in plain words. */
  what: string;
  /** How to fix it. */
  fix: string;
  /** How to confirm the fix worked. */
  verify: string;
};

const GUIDES: Record<string, LighthouseGuide> = {};

function a11y(id: string, title: string, what: string, fix: string, verify: string): void {
  GUIDES[id] = { category: "accessibility", title, what, fix, verify };
}

const PERF_VERIFY = "Re-run the SEO audit (or PageSpeed Insights) and check this audit no longer lists a problem, or its value has improved.";

function perf(id: string, title: string, what: string, fix: string, category: LighthouseCategory = "performance"): void {
  GUIDES[id] = { category, title, what, fix, verify: PERF_VERIFY };
}

// Accessibility ------------------------------------------------------------------------------------------------

a11y(
  "button-name",
  "Give every button a name",
  "Some buttons have no text or label, so a screen reader announces only \"button\" and voice-control users cannot say what to click.",
  "Put visible text inside each button. For an icon-only button add aria-label=\"Close\" (describe the action, not the icon) or visually hidden text.",
  "In Chrome DevTools select the button and open the Accessibility pane: the Name field must not be empty. Then re-run the audit.",
);
a11y(
  "link-name",
  "Give every link a name",
  "Some links have no readable text, so a screen reader announces only \"link\" and nobody can tell where it goes.",
  "Put descriptive text inside the link. For an icon or image link add aria-label=\"Pricing\" or alt text on the image that says where the link goes.",
  "In Chrome DevTools select the link and open the Accessibility pane: the Name field must say where it goes. Then re-run the audit.",
);
a11y(
  "image-alt",
  "Add alt text to images",
  "Some images have no alt attribute, so screen readers skip them or read out the file name.",
  "Add a short alt=\"...\" that describes what the image shows, or alt=\"\" if the image is purely decorative.",
  "View the page source and check every <img> has an alt attribute. Then re-run the audit.",
);
a11y(
  "input-image-alt",
  "Add alt text to image buttons",
  "An <input type=\"image\"> button has no alt text, so its purpose is not announced.",
  "Add alt=\"Search\" (the action the button performs) to each <input type=\"image\">.",
  "Inspect the button in the DevTools Accessibility pane: Name must describe the action. Then re-run the audit.",
);
a11y(
  "meta-viewport",
  "Allow visitors to zoom",
  "The viewport meta tag stops pinch-zoom (user-scalable=no or a maximum-scale below 5), which people with low vision rely on to read the page.",
  "In <meta name=\"viewport\"> remove user-scalable=no and any maximum-scale below 5, leaving content=\"width=device-width, initial-scale=1\".",
  "View the page source and check the tag, then pinch-zoom the page on a phone. Then re-run the audit.",
);
a11y(
  "heading-order",
  "Fix the heading order",
  "Headings jump a level (for example h2 straight to h4), so screen-reader users who navigate by headings lose the outline of the page.",
  "Make headings step down one level at a time: change the skipped heading to the next level (h4 to h3), or add the missing level. Choose the level by outline, not by font size; style it with CSS.",
  "Open the page outline with a headings extension (such as HeadingsMap) or DevTools and check no level is skipped. Then re-run the audit.",
);
a11y(
  "label-content-name-mismatch",
  "Make the accessible name match the visible text",
  "An element's accessible name (its aria-label) does not contain the text people see on it, so someone using voice control who says the visible label cannot activate it.",
  "Make the aria-label start with the exact visible text (visible \"Search\" can be aria-label=\"Search products\"), or remove the aria-label so the visible text is the name.",
  "Inspect the element in the DevTools Accessibility pane: the Name must contain the visible text word for word. Then re-run the audit.",
);
a11y(
  "color-contrast",
  "Make low-contrast text readable",
  "Some text is too close in colour to its background (below 4.5:1, or 3:1 for large text), which makes it hard to read for many people.",
  "Darken the text or lighten the background until the ratio reaches at least 4.5:1 (3:1 for text over 24px or bold over 19px).",
  "Click the text in DevTools and read the contrast ratio in the colour picker; it must show a pass. Then re-run the audit.",
);
a11y(
  "document-title",
  "Add a page title",
  "The page has no <title>, so screen-reader users and browser tabs have nothing to name it.",
  "Add a <title> in the <head> that names the page and the site.",
  "Check the browser tab shows the title. Then re-run the audit.",
);
a11y(
  "html-has-lang",
  "Declare the page language",
  "The <html> element has no lang attribute, so screen readers may read the page with the wrong pronunciation.",
  "Add lang=\"en\" (or the page's language code) to the <html> tag.",
  "View the page source and check the <html lang=\"...\"> attribute. Then re-run the audit.",
);
a11y(
  "html-lang-valid",
  "Use a valid language code",
  "The <html> lang attribute is not a valid language code, so screen readers cannot pick the right voice.",
  "Set lang to a valid BCP 47 code such as en, en-GB or fr.",
  "View the page source and check the <html lang> value against the code list. Then re-run the audit.",
);
a11y(
  "valid-lang",
  "Use valid language codes on page sections",
  "A lang attribute on part of the page is not a valid language code.",
  "Fix each lang attribute to a valid BCP 47 code such as es or de.",
  "Search the page source for lang= and check each value. Then re-run the audit.",
);
a11y(
  "label",
  "Label every form field",
  "Some form fields have no label, so screen readers cannot say what to type and clicking the label does not focus the field.",
  "Add a <label for=\"id\"> that matches the field's id, or wrap the field in a <label>. Placeholder text alone is not a label.",
  "Click the label text: the field should get focus. Then re-run the audit.",
);
a11y(
  "select-name",
  "Label every dropdown",
  "A <select> dropdown has no accessible name, so its purpose is not announced.",
  "Add a <label for=\"id\"> for the <select>, or an aria-label that says what the choice is for.",
  "Inspect the dropdown in the DevTools Accessibility pane: Name must not be empty. Then re-run the audit.",
);
a11y(
  "form-field-multiple-labels",
  "Give each form field a single label",
  "A form field has more than one label, and assistive technology may announce only one of them.",
  "Keep one <label> per field and merge the text of the others into it.",
  "Inspect the field in the DevTools Accessibility pane: Name must read as one sentence. Then re-run the audit.",
);
a11y(
  "aria-allowed-attr",
  "Remove ARIA attributes that do not fit the element",
  "An element uses an ARIA attribute its role does not support, which can mislead assistive technology.",
  "Remove the unsupported aria-* attribute, or change the element's role to one that supports it.",
  "Check each flagged element's role against the ARIA spec. Then re-run the audit.",
);
a11y(
  "aria-required-attr",
  "Add the ARIA attributes a role needs",
  "An element has an ARIA role but is missing an attribute that role requires (for example aria-checked on a checkbox role).",
  "Add the required aria-* attribute with a valid value, or use the native HTML element, which needs none.",
  "Check each flagged element's role against the ARIA spec. Then re-run the audit.",
);
a11y(
  "aria-valid-attr",
  "Fix misspelled ARIA attributes",
  "An aria-* attribute is not a real ARIA attribute (usually a typo), so it is ignored.",
  "Correct the attribute name (for example aria-labelledby, not aria-labeledby) or remove it.",
  "Search the page source for aria- and check each name. Then re-run the audit.",
);
a11y(
  "aria-valid-attr-value",
  "Fix invalid ARIA values",
  "An ARIA attribute has a value it does not allow, such as an aria-labelledby that points at an id that does not exist.",
  "Set a value the attribute allows (true or false, or the id of an element that exists on the page).",
  "Check each flagged attribute's value against the ARIA spec. Then re-run the audit.",
);
a11y(
  "aria-roles",
  "Use valid ARIA roles",
  "An element has a role value that is not a real ARIA role.",
  "Correct the role to a valid one, or remove it and use the matching HTML element.",
  "Check each flagged role against the ARIA spec. Then re-run the audit.",
);
a11y(
  "aria-hidden-focus",
  "Do not hide focusable elements",
  "An element hidden with aria-hidden=\"true\" still contains something a keyboard user can focus, so focus lands on something screen readers cannot see.",
  "Remove aria-hidden from the container, or make the focusable items inside unfocusable (tabindex=\"-1\" or the disabled attribute).",
  "Tab through the page: focus must never land on a hidden element. Then re-run the audit.",
);
a11y(
  "aria-input-field-name",
  "Name your custom input fields",
  "A custom input built with an ARIA role (such as combobox or textbox) has no accessible name.",
  "Add an aria-label or aria-labelledby that says what the field is for.",
  "Inspect the field in the DevTools Accessibility pane: Name must not be empty. Then re-run the audit.",
);
a11y(
  "aria-command-name",
  "Name your custom buttons and links",
  "An element with role button, link or menuitem has no accessible name.",
  "Add visible text or an aria-label that says what the control does.",
  "Inspect the element in the DevTools Accessibility pane: Name must not be empty. Then re-run the audit.",
);
a11y(
  "aria-toggle-field-name",
  "Name your custom toggles",
  "A custom toggle (checkbox, switch, menuitemcheckbox) has no accessible name.",
  "Add an aria-label or aria-labelledby that says what the toggle controls.",
  "Inspect the element in the DevTools Accessibility pane: Name must not be empty. Then re-run the audit.",
);
a11y(
  "tabindex",
  "Remove positive tabindex values",
  "An element has a tabindex above 0, which forces it ahead of everything else in keyboard order and confuses navigation.",
  "Change the value to tabindex=\"0\" or remove it, and reorder the HTML if the visual order needs to change.",
  "Tab through the page: the focus order must follow the visual order. Then re-run the audit.",
);
a11y(
  "frame-title",
  "Add a title to embedded frames",
  "An <iframe> has no title, so screen readers cannot say what it contains.",
  "Add title=\"...\" to each <iframe> describing its content, such as title=\"Product demo video\".",
  "Check every <iframe> in the page source has a title. Then re-run the audit.",
);
a11y(
  "list",
  "Use lists correctly",
  "A <ul> or <ol> contains something other than <li> items, so screen readers announce the list wrongly.",
  "Make the direct children of each <ul> and <ol> <li> elements and move other content inside an <li>.",
  "Inspect the flagged lists in the page source. Then re-run the audit.",
);
a11y(
  "listitem",
  "Put list items inside lists",
  "An <li> sits outside a <ul> or <ol>, so it is not announced as a list.",
  "Wrap the <li> elements in a <ul> or <ol>, or change them to another element.",
  "Inspect the flagged items in the page source. Then re-run the audit.",
);
a11y(
  "target-size",
  "Make tap targets bigger",
  "Some buttons or links are smaller than 24 by 24 pixels or too close together, which makes them hard to hit on a touch screen.",
  "Give each target at least 24 by 24 CSS pixels (44 is better) with padding, or add spacing between small ones.",
  "Open the page on a phone and tap each flagged control without mis-tapping. Then re-run the audit.",
);
a11y(
  "link-in-text-block",
  "Make links stand out from the text around them",
  "Links inside a paragraph are told apart only by colour, which people who cannot see the colour difference miss.",
  "Underline links in text (or add another cue such as bold) in addition to colour.",
  "View the paragraph in greyscale: the links must still be recognisable. Then re-run the audit.",
);
a11y(
  "bypass",
  "Let keyboard users skip the navigation",
  "The page has no way to jump past the repeated navigation, so keyboard users tab through every link on every page.",
  "Add a \"Skip to main content\" link as the first focusable element, pointing at the <main> element, or use landmarks and headings.",
  "Press Tab once on the page: a skip link should appear and jump to the content. Then re-run the audit.",
);
a11y(
  "scrollable-region-focusable",
  "Make scrollable areas reachable by keyboard",
  "A scrolling area cannot be reached with the keyboard, so keyboard users cannot read what is inside.",
  "Add tabindex=\"0\" to the scrollable container (with an aria-label), or make it contain a focusable element.",
  "Tab to the area and scroll it with the arrow keys. Then re-run the audit.",
);
a11y(
  "nested-interactive",
  "Do not nest buttons and links",
  "An interactive element (a button or link) is inside another one, which screen readers cannot announce reliably.",
  "Restructure so each control stands alone: move the inner control out, or remove its interactive role.",
  "Inspect the flagged elements in the page source. Then re-run the audit.",
);
a11y(
  "duplicate-id-aria",
  "Make ids referenced by ARIA unique",
  "Two elements share an id that an ARIA attribute points at, so the label or description can resolve to the wrong element.",
  "Give every id on the page a unique value and update the aria-labelledby or aria-describedby that uses it.",
  "Search the page source for the flagged id; it must appear once. Then re-run the audit.",
);
a11y(
  "object-alt",
  "Add alternative text to embedded objects",
  "An <object> element has no alternative text for people who cannot see it.",
  "Add aria-label or fallback text inside the <object> that says what it shows.",
  "Inspect the element in the DevTools Accessibility pane. Then re-run the audit.",
);
a11y(
  "video-caption",
  "Add captions to videos",
  "A <video> has no captions track, so deaf and hard-of-hearing visitors cannot follow it.",
  "Add a <track kind=\"captions\" src=\"captions.vtt\" srclang=\"en\"> to the video.",
  "Play the video and turn captions on. Then re-run the audit.",
);

// Performance, best practices and SEO audits that commonly appear ------------------------------------------------

perf(
  "render-blocking-resources",
  "Stop scripts and styles from blocking the first paint",
  "Scripts or stylesheets in the <head> hold up the first paint until they download.",
  "Add defer (or async) to non-critical <script> tags, inline the small critical CSS, and load the rest with media or preload so it does not block rendering.",
);
perf(
  "unused-javascript",
  "Ship less JavaScript",
  "The page downloads JavaScript that it does not run on load.",
  "Split the bundle by route, lazy-load code behind interactions, and remove libraries the page does not use.",
);
perf(
  "unused-css-rules",
  "Ship less CSS",
  "The page downloads CSS rules that nothing on the page uses.",
  "Remove unused styles, or split CSS per page, so only the rules the page needs are sent.",
);
perf(
  "unminified-javascript",
  "Minify JavaScript",
  "JavaScript is sent without minification, so it is larger than it needs to be.",
  "Enable minification in your build (production builds of most frameworks do this by default).",
);
perf(
  "unminified-css",
  "Minify CSS",
  "CSS is sent without minification, so it is larger than it needs to be.",
  "Enable CSS minification in your build.",
);
perf(
  "uses-optimized-images",
  "Compress images",
  "Some images are heavier than they need to be.",
  "Compress the flagged images (quality around 75 to 85) or serve them through an image optimiser.",
);
perf(
  "modern-image-formats",
  "Use modern image formats",
  "Images are served as JPEG or PNG where WebP or AVIF would be much smaller.",
  "Convert the flagged images to WebP or AVIF, with a fallback if you support very old browsers.",
);
perf(
  "uses-responsive-images",
  "Serve images at the size they are shown",
  "Images are larger than the space they fill, so extra bytes are downloaded.",
  "Resize the images, or add srcset and sizes so each device downloads a size that fits.",
);
perf(
  "offscreen-images",
  "Lazy-load images below the fold",
  "Images far down the page load immediately even though nobody can see them yet.",
  "Add loading=\"lazy\" to images that start below the first screen.",
);
perf(
  "uses-text-compression",
  "Compress text responses",
  "HTML, CSS or JavaScript is sent uncompressed.",
  "Turn on gzip or Brotli compression for text files in your server, CDN or hosting settings.",
);
perf(
  "uses-long-cache-ttl",
  "Cache static files for longer",
  "Static files are sent with a short or no cache lifetime, so repeat visitors download them again.",
  "Serve fingerprinted static files with Cache-Control: public, max-age=31536000, immutable.",
);
perf(
  "server-response-time",
  "Speed up the server response",
  "The server takes a long time to start answering.",
  "Cache the page or its data, speed up slow queries, and serve it from a location closer to visitors (a CDN).",
);
perf(
  "redirects",
  "Remove redirect hops",
  "Visitors are sent through extra redirects before the page loads.",
  "Link straight to the final address and collapse redirect chains into one hop.",
);
perf(
  "total-byte-weight",
  "Make the page lighter",
  "The page and everything it loads is very large.",
  "Remove or compress the largest files in the audit details (images, video, scripts, fonts).",
);
perf(
  "dom-size",
  "Reduce the number of page elements",
  "The page has a very large number of HTML elements, which slows rendering.",
  "Remove wrapper elements, paginate or virtualise long lists, and load heavy sections on demand.",
);
perf(
  "mainthread-work-breakdown",
  "Reduce main-thread work",
  "The browser spends a long time running scripts, layout and styling before the page is usable.",
  "Ship less JavaScript, break up long tasks, and defer work that is not needed for the first view.",
);
perf(
  "bootup-time",
  "Reduce JavaScript execution time",
  "Scripts take a long time to parse and run.",
  "Remove or defer heavy scripts (especially third-party ones) and split large bundles.",
);
perf(
  "third-party-summary",
  "Cut the cost of third-party scripts",
  "Third-party scripts such as analytics, chat widgets and ads take a share of load time.",
  "Remove the ones you do not need and load the rest after the page is interactive.",
);
perf(
  "font-display",
  "Show text while fonts load",
  "Text stays invisible until a web font finishes downloading.",
  "Add font-display: swap to each @font-face rule.",
);
perf(
  "unsized-images",
  "Give images a width and height",
  "Images have no set size, so the page jumps as they load.",
  "Add width and height attributes (or a CSS aspect-ratio) to each image.",
);
perf(
  "legacy-javascript",
  "Stop shipping legacy JavaScript",
  "The page ships polyfills and transforms that modern browsers do not need.",
  "Update your build target to modern browsers so these are not added.",
);
perf(
  "duplicated-javascript",
  "Remove duplicate JavaScript",
  "The same code is bundled more than once.",
  "Deduplicate shared libraries in your bundler configuration.",
);
perf(
  "long-tasks",
  "Break up long tasks",
  "Some scripts block the page for more than 50 ms at a time, so it feels frozen.",
  "Split long-running work into smaller chunks and yield to the browser between them.",
);
perf(
  "prioritize-lcp-image",
  "Load the main image first",
  "The largest image on the first screen is not loaded with high priority.",
  "Add fetchpriority=\"high\" to the main image and do not lazy-load it.",
);
perf(
  "lcp-lazy-loaded",
  "Do not lazy-load the main image",
  "The largest image on the first screen is lazy-loaded, which delays it.",
  "Remove loading=\"lazy\" from the main image.",
);
perf(
  "critical-request-chains",
  "Shorten the chain of requests the page waits on",
  "The page waits on a long chain of requests before it can show content.",
  "Preload or inline the key resources so they do not wait on each other.",
);
perf(
  "efficient-animated-content",
  "Replace animated GIFs with video",
  "Large animated GIFs are downloaded.",
  "Convert them to short MP4 or WebM videos with autoplay muted loop playsinline.",
);

// Best practices and SEO audits that Lighthouse can raise.
perf(
  "is-on-https",
  "Serve everything over HTTPS",
  "Some requests use plain HTTP, which can be read or changed in transit.",
  "Load every resource over https:// and redirect HTTP to HTTPS.",
  "best-practices",
);
perf(
  "errors-in-console",
  "Fix the browser console errors",
  "The page logs errors to the browser console, which often means something on it is broken.",
  "Open the browser console, reproduce the page load and fix each logged error.",
  "best-practices",
);
perf(
  "deprecations",
  "Replace deprecated browser features",
  "The page uses browser features that are being removed.",
  "Replace each deprecated API listed in the audit details with its modern equivalent.",
  "best-practices",
);
perf(
  "image-aspect-ratio",
  "Show images at their natural proportions",
  "Some images are stretched or squashed.",
  "Set width and height to match the image's real proportions, or use object-fit.",
  "best-practices",
);
perf(
  "viewport",
  "Add a viewport meta tag",
  "The page has no viewport meta tag, so phones show a shrunken desktop layout.",
  "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the <head>.",
  "seo",
);
perf(
  "font-size",
  "Use readable text sizes",
  "Too much text is smaller than 12px, which is hard to read on a phone.",
  "Raise small text to at least 12px (16px for body text).",
  "seo",
);
perf(
  "tap-targets",
  "Make tap targets bigger",
  "Some buttons or links are too small or too close together to tap.",
  "Give each target at least 48 by 48 CSS pixels including padding, with spacing between them.",
  "seo",
);
perf(
  "crawlable-anchors",
  "Make links crawlable",
  "Some links cannot be followed by search engines (no real href).",
  "Use <a href=\"/page\"> with a real URL instead of click handlers or javascript: links.",
  "seo",
);
perf(
  "link-text",
  "Use descriptive link text",
  "Some links say only \"click here\" or \"learn more\", which tells search engines and readers nothing.",
  "Rewrite the link text to say where it goes, such as \"See pricing plans\".",
  "seo",
);
perf(
  "is-crawlable",
  "Let search engines index the page",
  "The page is blocked from indexing, by a noindex tag or an X-Robots-Tag header.",
  "Remove the noindex directive if the page should appear in search.",
  "seo",
);
perf(
  "robots-txt",
  "Fix robots.txt",
  "The robots.txt file has errors that search engines may misread.",
  "Fix the lines flagged in the audit details so the file follows robots.txt syntax.",
  "seo",
);

/** The Lighthouse audit id behind a finding: recorded in its evidence, else the tail of `lighthouse-<device>-<auditId>`. */
export function lighthouseAuditId(finding: { entityId: string; evidence?: Record<string, unknown> }): string {
  const recorded = finding.evidence?.auditId;
  if (typeof recorded === "string" && recorded.trim()) return recorded.trim();
  return finding.entityId.replace(/^lighthouse-(mobile|desktop)-/, "").replace(/^lighthouse-/, "");
}

export function isLighthouseCategory(value: unknown): value is LighthouseCategory {
  return typeof value === "string" && (LIGHTHOUSE_CATEGORIES as readonly string[]).includes(value);
}

/** The step-by-step guide for a known Lighthouse audit, or null (an unknown audit gets neutral wording, never a guess). */
export function lighthouseGuide(auditId: string): LighthouseGuide | null {
  return GUIDES[auditId] ?? null;
}

/** The Lighthouse category of a finding: what the audit recorded, else our table, else null (unknown). */
export function lighthouseCategoryOf(finding: { entityId: string; evidence?: Record<string, unknown> }): LighthouseCategory | null {
  const recorded = finding.evidence?.lighthouseCategory;
  if (isLighthouseCategory(recorded)) return recorded;
  return lighthouseGuide(lighthouseAuditId(finding))?.category ?? null;
}

/** Every audit id Marlo has a guide for, so tests can walk the whole table. */
export function knownLighthouseAuditIds(): string[] {
  return Object.keys(GUIDES);
}

export const LIGHTHOUSE_CATEGORY_LABEL: Record<LighthouseCategory, string> = {
  accessibility: "accessibility",
  performance: "performance",
  "best-practices": "best-practice",
  seo: "SEO",
};

/** Text for a Lighthouse score (0 to 1). A score that was not measured says so; it is never shown as 0. */
export function lighthouseScoreLabel(score: unknown): string {
  return typeof score === "number" && Number.isFinite(score) ? `${Math.round(score * 100)}/100` : "Not measured";
}
