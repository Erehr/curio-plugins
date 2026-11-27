// The choices made in one file become the next file's of its kind (reader.js `remember`); which contents tab is open belongs to the file alone.
const OWN_ONLY = ['sideTab']

/** The choices in `own` that differ from `was`, or null when none do. */
export function rememberedChanges(own, was) {
  const out = {}
  for (const [k, v] of Object.entries(own)) if (!OWN_ONLY.includes(k) && JSON.stringify(v) !== JSON.stringify(was[k])) out[k] = v
  return Object.keys(out).length ? out : null
}
