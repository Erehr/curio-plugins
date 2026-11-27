// Generation settings kept in pictures: PNG text chunks, EXIF comments and the text tags ComfyUI writes into WebP, as `[key, value]` pairs, the first of a key winning.
import { analyze, displayName, loraTags } from './comfy.js'

const SETTING_KEY = /(?:^|,\s*)[A-Za-z][\w \-/()]*:\s/g
const NUMBERED_LORA = /^Lora_(\d+) (Model name|Strength model)$/i
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

const num = (s) => (typeof s === 'string' && NUMBER.test(s.trim()) ? Number(s.trim()) : null)

// a seed's digits, quoted before parsing: ComfyUI's go past what a number holds exactly
const SEED = /("(?:seed|noise_seed)"\s*:\s*)(-?\d{16,})(?=\s*[,}\]])/g

/** JSON, with seeds and any other integer past what a number holds exactly kept as their digits. */
export function parseJson(text) {
  return JSON.parse(String(text).replace(SEED, '$1"$2"'), (k, v, context) => (typeof v === 'number' && !Number.isSafeInteger(v) && Number.isInteger(v) && /^-?\d+$/.test(context?.source ?? '') ? context.source : v))
}

function isJson(text) {
  try {
    parseJson(text)
    return true
  } catch {
    return false
  }
}

/** An API-format graph: node ids mapping to `{class_type, inputs}`; null for anything else. */
function comfyGraph(text) {
  let v
  try {
    v = parseJson(String(text).trim())
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const nodes = Object.values(v)
  return nodes.length && nodes.some((n) => n && typeof n.class_type === 'string') ? v : null
}

/** A key only generation settings fill: text without one is no generation's. */
const isSetting = (k) => ['negative_prompt', 'steps', 'sampler', 'seed', 'cfg', 'model', 'model_hash'].includes(k)

/** What a picture's text chunks say: `chunks` by keyword, as `item.pngText` answers them or as ComfyUI writes them into EXIF tags. */
export function fromTextChunks(chunks) {
  const out = []
  const graph = 'prompt' in chunks ? comfyGraph(chunks.prompt) : null
  const workflow = 'workflow' in chunks && isJson(chunks.workflow)
  const p = chunks.parameters
  // settings a save node wrote as A1111 text are what the file says of itself; the graph is walked only for a file saved without them
  let written = p !== undefined && !comfyGraph(p) && !isJson(p) ? parseA1111(p) : null
  if (written && !written.some(([k]) => isSetting(k))) written = null
  if (written) {
    // ComfyUI's save nodes rarely name the software; A1111's own text names its version
    if (graph || workflow) {
      written = written.filter(([k, x]) => !(k === 'software' && x === 'Stable Diffusion WebUI'))
      written.push(['software', 'ComfyUI'])
    }
    out.push(...written)
  } else if (graph) {
    out.push(...parseComfy(graph))
  }
  if (p !== undefined && !out.length) {
    // some tools put the whole graph where A1111 puts its text
    const g = comfyGraph(p)
    if (g) out.push(...parseComfy(g))
    else if (!isJson(p)) out.push(...parseA1111(p))
  }
  // a workflow tells only the software: ComfyUI takes the graph from the file itself, and stored it costs tens of KB an item
  if (workflow && !out.some(([k]) => k === 'software')) out.push(['software', 'ComfyUI'])
  if ('Comment' in chunks) {
    try {
      out.push(...parseNovelai(parseJson(chunks.Comment), chunks.Software))
    } catch {
      /* not NovelAI's */
    }
  }
  if ('Software' in chunks) out.push(['software', chunks.Software])
  return out
}

// tags `item.exif` answers whose text is no ASCII tag's: the comments, read as comments below
const NOT_ASCII = new Set(['UserComment', 'XPComment', 'XPTitle', 'XPAuthor', 'XPKeywords', 'XPSubject'])

/** The generation settings in a picture's EXIF, `tags` as `item.exif` answers them: graphs ComfyUI keeps in text tags, and A1111 text in a comment or description. */
export function fromExif(tags) {
  const out = []
  // ComfyUI saves WebP with its graphs as "prompt:{...}" and "workflow:{...}" in text tags, Make and Model among them
  const chunks = {}
  const taken = new Set()
  for (const [tag, text] of Object.entries(tags)) {
    if (NOT_ASCII.has(tag)) continue
    const at = text.indexOf(':')
    if (at < 0) continue
    const key = text.slice(0, at)
    const body = text.slice(at + 1).trimStart()
    if (key && /^[A-Za-z0-9_]+$/.test(key) && (body.startsWith('{') || body.startsWith('[')) && isJson(body)) {
      chunks[key] = body
      taken.add(tag)
    }
  }
  if (Object.keys(chunks).length) out.push(...fromTextChunks(chunks))
  const comments = [tags.UserComment, tags.XPComment]
  if (!taken.has('ImageDescription')) comments.push(tags.ImageDescription?.replace(/^"|"$/g, '').trim())
  for (const c of comments.filter((c) => typeof c === 'string')) {
    const found = fromComment(c)
    if (found.length) {
      out.push(...found)
      break
    }
  }
  return out
}

/** Generation text kept in an EXIF comment. Those also hold camera and encoder notes ("CREATOR: gd-jpeg ..."), so A1111 text counts only with a negative prompt or a real setting. */
function fromComment(text) {
  text = text.replace(/^\u0000+|\u0000+$/g, '').trim()
  const g = comfyGraph(text)
  if (g) return parseComfy(g)
  if (!text || isJson(text)) return []
  const out = parseA1111(text)
  return out.some(([k]) => isSetting(k)) ? out : []
}

/** A1111's settings line: `Key: value, ...` where a value may be a quoted string or JSON, both of which can hold commas. */
function parseSettings(line) {
  const c = Array.from(line)
  const n = c.length
  const text = (a, b) => c.slice(Math.min(a, n), Math.min(b, n)).join('')
  const out = []
  let i = 0
  while (i < n) {
    while (i < n && (c[i] === ' ' || c[i] === ',')) i++
    let colon = -1
    for (let j = i; j < n; j++) {
      if (c[j] === ':') {
        colon = j
        break
      }
    }
    if (colon < 0) break
    const key = text(i, colon).trim()
    i = colon + 1
    while (i < n && c[i] === ' ') i++
    let value
    if (i < n && c[i] === '"') {
      let j = i + 1
      while (j < n && c[j] !== '"') j += c[j] === '\\' ? 2 : 1
      try {
        value = JSON.parse(text(i, j + 1))
      } catch {
        value = text(i + 1, j)
      }
      i = j + 1
    } else if (i < n && (c[i] === '{' || c[i] === '[')) {
      let depth = 0
      let j = i
      let inString = false
      while (j < n) {
        const ch = c[j]
        if (inString) {
          if (ch === '\\') j++
          else if (ch === '"') inString = false
        } else if (ch === '"') inString = true
        else if (ch === '{' || ch === '[') depth++
        else if (ch === '}' || ch === ']') {
          depth--
          if (depth === 0) break
        }
        j++
      }
      value = text(i, j + 1)
      i = j + 1
    } else {
      let end = n
      for (let j = i; j < n; j++) {
        if (c[j] === ',') {
          end = j
          break
        }
      }
      value = text(i, end).trim()
      i = end
    }
    if (key) out.push([key, value])
  }
  return out
}

const isSettingsLine = (line) => line.trimStart().startsWith('Steps: ') || (line.match(SETTING_KEY) || []).length >= 3

/** AUTOMATIC1111 / Forge / SD.Next "parameters" text: the prompt, "Negative prompt:" and a closing settings line. */
export function parseA1111(text) {
  const out = []
  const lines = String(text).replaceAll('\r', '').split('\n')
  let settingsAt = null
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isSettingsLine(lines[i])) {
      settingsAt = i
      break
    }
    if (lines[i].trim()) break
  }
  const body = lines.slice(0, settingsAt ?? lines.length)
  const negAt = body.findIndex((l) => l.trimStart().slice(0, 16).toLowerCase() === 'negative prompt:')
  const prompt = body.slice(0, negAt < 0 ? body.length : negAt).join('\n').trim()
  const negative = negAt < 0 ? '' : body.slice(negAt).join('\n').trimStart().slice(16).trim()
  const settings = settingsAt === null ? [] : parseSettings(lines.slice(settingsAt).join(' '))
  const map = new Map(settings.map(([k, v]) => [k.toLowerCase(), v]))
  const get = (keys) => {
    for (const k of keys) if (map.has(k)) return map.get(k) || null
    return null
  }
  if (prompt) out.push(['prompt', prompt])
  if (negative) out.push(['negative_prompt', negative])
  const number = (keys) => num(get(keys))
  const version = get(['version'])
  const model = get(['model'])
  const vae = get(['vae'])
  for (const [key, v] of [
    ['steps', number(['steps'])],
    ['sampler', get(['sampler'])],
    ['scheduler', get(['schedule type', 'scheduler'])],
    ['cfg', number(['cfg scale', 'cfg'])],
    ['seed', get(['seed'])],
    ['denoise', number(['denoising strength', 'denoise'])],
    ['clip_skip', number(['clip skip'])],
    ['model', model && displayName(model)],
    ['model_hash', get(['model hash'])],
    ['vae', vae && displayName(vae)],
    ['software', version && `Stable Diffusion WebUI ${version}`],
  ]) {
    if (v !== null && v !== undefined) out.push([key, v])
  }
  // the universal save node lists "Lora_N Model name" and "Lora_N Strength model"; LoRAs written in the prompt follow
  const numbered = []
  for (const [k, v] of settings) {
    const m = NUMBERED_LORA.exec(k)
    if (!m) continue
    const n = Number(m[1])
    let e = numbered.find((x) => x[0] === n)
    if (!e) numbered.push((e = [n, '', 1]))
    if (m[2].toLowerCase() === 'model name') e[1] = v
    else e[2] = num(v) ?? 1
  }
  numbered.sort((a, b) => a[0] - b[0])
  const seen = new Set()
  const loras = []
  const strengths = []
  for (const [raw, strength] of [...numbered.map((e) => [e[1], e[2]]), ...loraTags(prompt).map(([n, s]) => [n, s])]) {
    const name = displayName(raw)
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase())
      loras.push(name)
      strengths.push(strength)
    }
  }
  if (loras.length) out.push(['lora', loras], ['lora_strength', strengths])
  if (settings.length && !out.some(([k]) => k === 'software')) out.push(['software', 'Stable Diffusion WebUI'])
  return out
}

/** ComfyUI's API-format prompt graph. */
export function parseComfy(graph) {
  const out = []
  const g = analyze(graph)
  if (!g) return out
  if (g.positive) out.push(['prompt', g.positive])
  if (g.negative) out.push(['negative_prompt', g.negative])
  for (const [key, v] of g.params) {
    let value
    if (key === 'seed') value = typeof v === 'string' ? v : JSON.stringify(v)
    // graphs store floats like 1.4000000000000004
    else if (typeof v === 'number') value = Math.round(v * 1e6) / 1e6
    else if (typeof v === 'string') value = num(v) !== null && key !== 'sampler' && key !== 'scheduler' ? num(v) : v
    else continue
    // guidance and shift have no field of their own
    if (['seed', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise', 'clip_skip'].includes(key)) out.push([key, value])
  }
  if (g.model) out.push(['model', displayName(g.model)])
  if (g.vae) out.push(['vae', displayName(g.vae)])
  if (g.loras.length) out.push(['lora', g.loras.map(([n]) => displayName(n))], ['lora_strength', g.loras.map(([, s]) => s)])
  if (out.length) out.push(['software', 'ComfyUI'])
  return out
}

function parseNovelai(v, software) {
  const out = []
  if (!v || typeof v !== 'object') return out
  if (typeof v.prompt === 'string') out.push(['prompt', v.prompt])
  if (typeof v.uc === 'string') out.push(['negative_prompt', v.uc])
  if (typeof v.steps === 'number') out.push(['steps', v.steps])
  if (typeof v.scale === 'number') out.push(['cfg', v.scale])
  if (typeof v.seed === 'number' || (typeof v.seed === 'string' && /^-?\d+$/.test(v.seed))) out.push(['seed', String(v.seed)])
  if (typeof v.sampler === 'string') out.push(['sampler', v.sampler])
  if (out.length) out.push(['software', software || 'NovelAI'])
  return out
}
