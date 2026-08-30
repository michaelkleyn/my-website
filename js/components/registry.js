/**
 * Component host registry (ES module).
 *
 * Part of the Layout Compositor scene system. Components are reusable,
 * positioned visual modules (e.g. a Gaussian-splat butterfly, a ripple-text
 * panel) that the scene renderer mounts into `.scene-layer` based on a scene
 * node of kind "component".
 *
 * Contract (see docs/SPLAT-INTEGRATION.md):
 *   - register(def): add/replace a component definition, keyed by def.name.
 *   - get(name): look up a previously registered definition (or undefined).
 *   - Both are also mirrored onto `window.sceneComponents = { register, get }`
 *     so classic <script> code (the renderer) can reach them without importing
 *     this module.
 *
 * A "def" is the shape documented in the host contract:
 *   {
 *     name: string,
 *     configSchema: Array<FieldSpec>,
 *     async mount(container, ctx): Promise<instance>,
 *     update(instance, ctx): void,
 *     destroy(instance): void
 *   }
 *
 * Registration is IDEMPOTENT by name: a component module self-registers on
 * import, and the same module may be imported more than once (the renderer
 * dynamically import()s it per node, the editor may import it for its schema).
 * Re-registering the same name simply replaces the stored def — no throw, no
 * duplicate state. We log when a name is overwritten so accidental clashes are
 * visible during local dev.
 */

/** @type {Map<string, object>} name -> component def */
const REGISTRY = new Map();

/**
 * Register (or replace) a component definition.
 * @param {object} def - component definition; must have a string `name`.
 * @returns {object} the same def, for convenient `export default register(def)`.
 */
export function register(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('[components] register() requires a def object');
  }
  if (typeof def.name !== 'string' || def.name.length === 0) {
    throw new TypeError('[components] register() requires def.name (string)');
  }
  if (typeof def.mount !== 'function') {
    throw new TypeError(`[components] "${def.name}" def.mount must be a function`);
  }

  if (REGISTRY.has(def.name) && REGISTRY.get(def.name) !== def) {
    // Idempotent-but-noisy: overwriting an existing distinct def for this name.
    console.warn(`[components] re-registering "${def.name}" (overwriting prior def)`);
  }
  REGISTRY.set(def.name, def);
  return def;
}

/**
 * Look up a registered component definition.
 * @param {string} name
 * @returns {object|undefined} the def, or undefined if not registered.
 */
export function get(name) {
  return REGISTRY.get(name);
}

/**
 * Enumerate registered component names (handy for the editor's component picker).
 * @returns {string[]}
 */
export function list() {
  return [...REGISTRY.keys()];
}

// Mirror onto the global so the classic-script renderer (js/scene-renderer.js)
// can reach the registry after dynamically import()ing a component module.
// Guard against double-install on hot reload — keep the same Map-backed fns.
if (typeof window !== 'undefined') {
  const existing = window.sceneComponents;
  if (existing && typeof existing.register === 'function' && typeof existing.get === 'function') {
    // Another copy of this module already installed the global. Keep it; our
    // exported fns share the same module-scope REGISTRY only within THIS module
    // instance, so prefer the already-installed one to avoid split registries.
    // (In practice the renderer imports this module exactly once.)
  } else {
    // Mirror EXACTLY the contract surface { register, get }. list() stays an ES
    // module export only (the editor's component picker imports it directly);
    // keeping it off the global avoids over-exposing beyond the shared contract.
    window.sceneComponents = { register, get };
  }
}
