/* =============================================================================
 * Cook County Cooks — assets/dom.js
 * THE FOUR DOM FUNCTIONS, SHARED
 * -----------------------------------------------------------------------------
 * These three helpers were private to the cinema integrator. The pocket list
 * (the phone build) and the cold-storage gate both build DOM the same way and
 * must not import the integrator to do it — the whole point of the pocket build
 * is that a phone never downloads the cinema. So they live here, once.
 *
 * Deliberately still not a framework. Three functions and a query alias.
 * ========================================================================== */

/* ─────────────────────────────────────────────────────────────────────────────
 * 0 · TINY DOM HELPERS
 * Deliberately minimal — this is not a framework, it is four functions.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Build an element in one breath.
 * `class`, `text` and `style` are special-cased; anything else becomes an
 * attribute, so data-* and aria-* work without ceremony. A `false`/`null` value
 * omits the attribute entirely, which keeps the callers below free of `if`s.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/** Replace an element's children in one shot. */
export function fill(node, children) {
  node.replaceChildren(...[].concat(children).filter(Boolean));
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
