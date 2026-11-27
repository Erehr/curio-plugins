// AI model files: what the files grouped into them say (LoRA Manager's `<name>.metadata.json`, Civitai's `<name>.civitai.info`, A1111's `<name>.json`: the name Civitai gives the model, its type, base model, version, creator, trigger words, page and description), and what a safetensors file's own header says where those are missing.

// the files whose own header is read: `.ckpt` is a pickle, never opened, and `.gguf` keeps its metadata otherwise; those are read from their sidecars alone
const HEADER_EXTS = ['safetensors', 'sft']
// real headers are under a megabyte; a file claiming more isn't a model
const MAX_HEADER = 64 * 1024 * 1024
const MAX_SIDECAR = 8 * 1024 * 1024

/** The bytes of `url` from `start` up to `end` (exclusive), by a Range request. */
async function range(url, start, end) {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
  if (!r.ok) throw new Error(`The file can't be read (${r.status})`)
  const b = new Uint8Array(await r.arrayBuffer())
  // a server that sends the whole file answers 200: the part asked for is cut from it
  return r.status === 206 ? b : b.subarray(start, end)
}

/** The JSON header of a safetensors file of `size` bytes: tensor names, and `__metadata__` from training. */
async function header(url, size) {
  const bad = new Error('Not a safetensors file')
  if (size < 10) throw bad
  const len = await range(url, 0, 8)
  if (len.length < 8) throw bad
  const n = Number(new DataView(len.buffer, len.byteOffset, 8).getBigUint64(0, true))
  // nothing is fetched for a length the file can't hold
  if (n < 2 || n > MAX_HEADER || n > size - 8) throw bad
  try {
    const v = JSON.parse(new TextDecoder().decode(await range(url, 8, 8 + n)))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {
    /* falls through to the refusal */
  }
  throw bad
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const words = (v) => (Array.isArray(v) ? v.map(text).filter((w) => w) : [])
const pointer = (o, p) => p.split('/').slice(1).reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o)

const unescape = (s) => s.replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&apos;', "'").replaceAll('&amp;', '&')

/** Text of an HTML description: tags dropped, entities decoded, whitespace folded. */
function plainText(html) {
  let out = ''
  let inTag = false
  for (const c of unescape(html)) {
    if (c === '<') {
      inTag = true
      out += ' '
    } else if (c === '>' && inTag) inTag = false
    else if (!inTag) out += c
  }
  return unescape(out).split(/\s+/).filter((w) => w).join(' ')
}

const plain = (v) => (v === null ? null : plainText(v) || null)

const TYPES = { lora: 'LoRA', locon: 'LoCon', lycoris: 'LoCon', dora: 'DoRA', checkpoint: 'Checkpoint', textualinversion: 'Embedding', embedding: 'Embedding', vae: 'VAE', controlnet: 'ControlNet', upscaler: 'Upscaler' }
/** Civitai's and LoRA Manager's names of a type, as people write them. */
const typeName = (t) => TYPES[t.toLowerCase()] || t

const BASES = [['sdxl', 'SDXL 1.0'], ['stable-diffusion-xl', 'SDXL 1.0'], ['stable-diffusion-v1', 'SD 1.5'], ['sd_v1', 'SD 1.5'], ['sd1', 'SD 1.5'], ['krea2', 'Krea 2'], ['krea-2', 'Krea 2'], ['anima', 'Anima'], ['illustrious', 'Illustrious'], ['pony', 'Pony'], ['flux', 'Flux.1']]
/** What training tools write as the base model, as Civitai names it. */
function baseName(raw) {
  const l = raw.toLowerCase()
  return BASES.find(([k]) => l.includes(k))?.[1] ?? raw.replace(/(\/lora)+$/, '')
}

const civitaiUrl = (model, version) => (Number.isInteger(model) && Number.isInteger(version) ? `https://civitai.com/models/${model}?modelVersionId=${version}` : null)

/**
 * What a model says, each source filling only what those before it left: LoRA Manager's file, Civitai's, A1111's, then the header.
 * `data` is `plugin.extract`'s: the model's `fileUrl`, `name`, `ext`, `size` and `parts`, the files grouped into it.
 */
export async function readModel(data) {
  const stem = data.name.includes('.') ? data.name.slice(0, data.name.lastIndexOf('.')).toLowerCase() : data.name.toLowerCase()
  // a grouped file is named after the model: the stem, then its ending
  const json = async (ending) => {
    const p = data.parts.find((x) => x.name.toLowerCase() === stem + ending)
    if (!p?.fileUrl || p.size > MAX_SIDECAR) return null
    try {
      const r = await fetch(p.fileUrl)
      return r.ok ? JSON.parse(await r.text()) : null
    } catch {
      return null
    }
  }
  const out = {}
  const put = (k, v) => {
    if (v !== null && v !== undefined && !(k in out)) out[k] = v
  }
  const putList = (k, v) => {
    if (v.length && !(k in out)) out[k] = v
  }
  const s = await json('.metadata.json')
  if (s && typeof s === 'object') {
    const c = s.civitai && typeof s.civitai === 'object' && !Array.isArray(s.civitai) ? s.civitai : null
    const at = (p) => (c ? pointer(c, p) : undefined)
    const type = text(at('/model/type')) ?? text(s.sub_type)
    put('__title', text(s.model_name))
    put('model_type', type && typeName(type))
    put('base_model', text(s.base_model) ?? text(at('/baseModel')))
    put('model_version', text(at('/name')))
    put('creator', text(at('/creator/username')))
    putList('trigger_words', words(at('/trainedWords')))
    put('__source_url', civitaiUrl(at('/modelId'), at('/id')))
    put('__annotation', text(s.notes) ?? plain(text(s.modelDescription)))
  }
  // Civitai's version object, as Stability Matrix and the Civitai Helper keep it
  const i = await json('.civitai.info')
  if (i && typeof i === 'object') {
    const type = text(pointer(i, '/model/type'))
    put('__title', text(pointer(i, '/model/name')))
    put('model_type', type && typeName(type))
    put('base_model', text(i.baseModel))
    put('model_version', text(i.name))
    put('creator', text(pointer(i, '/creator/username')) ?? text(pointer(i, '/model/creator/username')))
    putList('trigger_words', words(i.trainedWords))
    put('__source_url', civitaiUrl(i.modelId, i.id))
    put('__annotation', plain(text(i.description)))
  }
  // A1111's own notes on a model
  const a = await json('.json')
  if (a && typeof a === 'object') {
    const base = text(a['sd version'])
    put('base_model', base && base.toLowerCase() !== 'unknown' ? baseName(base) : null)
    putList('trigger_words', (text(a['activation text']) || '').split(',').map((w) => w.trim()).filter((w) => w))
    put('__annotation', text(a.notes) ?? plain(text(a.description)))
  }
  let head = {}
  if (HEADER_EXTS.includes(data.ext.toLowerCase())) {
    try {
      head = await header(data.fileUrl, data.size)
    } catch (e) {
      // a header that can't be read fails the file only when nothing beside it spoke for it
      if (!Object.keys(out).length) throw e
    }
  }
  const meta = head.__metadata__ && typeof head.__metadata__ === 'object' ? head.__metadata__ : {}
  const m = (k) => text(meta[k])
  const arch = m('modelspec.architecture') || ''
  const lora = arch.endsWith('/lora') || m('ss_network_module') !== null || Object.keys(head).some((k) => k.includes('lora_') || k.includes('.lora.') || k.startsWith('lycoris_'))
  put('model_type', lora ? 'LoRA' : null)
  const base = m('ss_base_model_version') ?? (arch || null)
  put('base_model', base && baseName(base))
  return out
}
