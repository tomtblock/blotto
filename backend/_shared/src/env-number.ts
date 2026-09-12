/**
 * Numeric environment variables that fail fast (audit 2026-09-11, E-20).
 *
 * THE DEFECT. Three service entrypoints parsed their numeric settings with a
 * bare `Number(env.X ?? default)`. JavaScript's `Number` is not a parser, it
 * is a coercion, and it has two answers nobody wants from a config file:
 *
 *   Number('')       === 0      — a variable set to the empty string, which
 *                                 is what a blank value in a `.env` file, an
 *                                 unresolved CI expression or a cleared Fly
 *                                 secret all produce;
 *   Number('4000ms') === NaN    — and NaN then flows on silently: it compares
 *                                 false against every bound, so a guard like
 *                                 `if (cap > 0)` simply does not fire.
 *
 * Both are silent. A blank `GEO_CACHE_TTL_MS` turned the per-address cache
 * off and started paying a vendor twice per entrant; a blank
 * `BLOTTO_PACKET_PORT` would bind port 0, which the operating system
 * cheerfully accepts and assigns at random, so the service comes up healthy
 * on an address nothing routes to.
 *
 * A configuration value that cannot be read is not a default, it is an
 * operator mistake, and the moment to say so is boot — before the listener
 * opens, while the deploy is still watching.
 */

/** The environment as read — `process.env`, or an injected map in a test. */
export type EnvMap = Record<string, string | undefined>;

export interface IntEnvBounds {
  /** Inclusive lower bound. */
  min?: number;
  /** Inclusive upper bound. */
  max?: number;
}

/** Base 10, optional sign, digits only. No floats, no hex, no exponents, no units. */
const INTEGER = /^[+-]?\d+$/;

function parse(name: string, raw: string, bounds: IntEnvBounds | undefined): number {
  const text = raw.trim();
  if (text === '') {
    throw new Error(
      `${name} is set but empty — unset it to take the default, or give it a whole number`
    );
  }
  if (!INTEGER.test(text)) {
    throw new Error(`${name} must be a whole number, got ${JSON.stringify(raw)}`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} is too large to be exact, got ${JSON.stringify(raw)}`);
  }
  if (bounds?.min !== undefined && value < bounds.min) {
    throw new Error(`${name} must be at least ${bounds.min}, got ${value}`);
  }
  if (bounds?.max !== undefined && value > bounds.max) {
    throw new Error(`${name} must be at most ${bounds.max}, got ${value}`);
  }
  return value;
}

/**
 * Read a whole-number setting, or take `fallback` when the variable is
 * absent. Throws on anything present that is not a whole number in range.
 *
 * "Absent" means the key is not in the environment at all. A key that is
 * present and blank is an error, not an absence: something set it, and
 * guessing which of the two was meant is how a cleared secret becomes a
 * zero-valued setting nobody notices.
 */
export function intEnv(
  env: EnvMap,
  name: string,
  fallback: number,
  bounds?: IntEnvBounds
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  return parse(name, raw, bounds);
}

/**
 * The same, for a setting whose absence is itself meaningful — a ceiling
 * that is off when unset, say, rather than off when zero.
 */
export function optionalIntEnv(
  env: EnvMap,
  name: string,
  bounds?: IntEnvBounds
): number | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  return parse(name, raw, bounds);
}

/** A TCP port: 1-65535. Zero is excluded deliberately — see the module doc. */
export function portEnv(env: EnvMap, name: string, fallback: number): number {
  return intEnv(env, name, fallback, { min: 1, max: 65535 });
}
