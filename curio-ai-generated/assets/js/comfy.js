// Generation details from ComfyUI's executed (API) graph: which sampler made the image, what its prompts evaluated to, and what fed it. Capture rules follow ComfyUI_SaveImageWithMetaDataUniversal, and EreNodes prompt chains evaluate as they executed.

const LORA_TAG = /<lora:([^:>]+)(?::(-?[0-9.]+))?(?::(-?[0-9.]+))?>/g
const LINE_START_COMMA = /^[ \t]*,[ \t]*/gm
const DOUBLE_COMMA = /[ \t]*,[ \t]*,/g
const END_COMMA = /[ \t]*,[ \t]*$/g
const SPACES = /[ \t]{2,}/g
const ENCODER_NAME = /(text\s*encode|encode\s*text|prompt\s*encode|encode\s*prompt|text[-_ ]?encoder|cliptextencode|t5\s*xxl\s*encode|t5\s*encode)/i
const NUMBERED_PART = /^(text|string)_?[a-z0-9]$/i
const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|lora)$/i

const DEFAULT_SEPARATOR = ',\\n\\n'
const TERMINATORS = ',.;:!?'

/** A model file's name as people say it: no folders, no `.safetensors` or the like; dots inside names like `v2.5` stay. */
export const displayName = (name) => String(name).split(/[/\\]/).pop().replace(MODEL_EXT, '')

const modelKey = (name) => displayName(name).toLowerCase()

const isNone = (v) => v == null || v === '' || v === 'None' || v === 'none'

function toNumber(v, fallback) {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.trim()))) return Number(v.trim())
  return fallback
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// ------------------------------------------------------------------ prompt strings (EreNodes)

function separatorAfter(separator, previous) {
  const last = previous.trimEnd().slice(-1)
  if (last && TERMINATORS.includes(last)) {
    let i = 0
    while (i < separator.length && TERMINATORS.includes(separator[i])) i++
    return separator.slice(i)
  }
  return separator
}

function joinParts(parts, separator) {
  const sep = (separator || DEFAULT_SEPARATOR).replaceAll('\\n', '\n')
  let out = ''
  for (const part of parts.filter((p) => p)) {
    if (out) out += separatorAfter(sep, out)
    out += part
  }
  return out
}

const combinePrompt = (text, prefix, separator) => joinParts([prefix, text], separator)

function collapseSeparators(text) {
  let t = text
  for (;;) {
    const next = t.replace(DOUBLE_COMMA, ',')
    if (next === t) break
    t = next
  }
  t = t.replace(LINE_START_COMMA, '').replace(END_COMMA, '').replace(SPACES, ' ')
  return t.trim().replace(/^,+|,+$/g, '').trim()
}

const stripLoraTags = (text) => collapseSeparators(text.replace(LORA_TAG, ''))

/** `<lora:name>`, `<lora:name:model>` or `<lora:name:model:clip>`: [name, strength, clip]. */
export function loraTags(text) {
  return [...String(text).matchAll(LORA_TAG)].map((m) => {
    const strength = m[2] !== undefined && Number.isFinite(Number(m[2])) ? Number(m[2]) : 1
    const clip = m[3] !== undefined && Number.isFinite(Number(m[3])) ? Number(m[3]) : strength
    return [m[1].trim(), strength, clip]
  })
}

// ------------------------------------------------------------------ capture rules

// where a value is read from on a node: an input, the first set of several, a constant, or CLIPSetLastLayer's negative layer index
const K = (key) => ({ key })
const KS = (keys) => ({ keys })
const C = (value) => ({ value })
const CLIP_SKIP = { clipSkip: true }

const PARAM_KEYS = ['seed', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise', 'guidance', 'shift', 'clip_skip']
const GENERIC_PARAMS = [['seed', ['seed', 'noise_seed']], ['steps', ['steps']], ['cfg', ['cfg']], ['sampler', ['sampler_name']], ['scheduler', ['scheduler']], ['denoise', ['denoise']], ['guidance', ['guidance']], ['shift', ['shift']]]

const samplerRule = () => ({ seed: K('seed'), steps: K('steps'), cfg: K('cfg'), sampler: K('sampler_name'), scheduler: K('scheduler'), denoise: K('denoise') })
const advSamplerRule = () => ({ seed: K('noise_seed'), steps: K('steps'), cfg: K('cfg'), sampler: K('sampler_name'), scheduler: K('scheduler') })
const textRule = (positive, negative) => ({ positive, negative })
const lorasRule = (loras) => ({ loras })
const scheduled = (name) => ({ steps: K('steps'), scheduler: C(name) })
const loader = (model) => ({ model: K(model) })
const fullLoader = (model, skip) => ({ model: K(model), clip_skip: K(skip), positive: K('positive'), negative: K('negative'), loras: { inline: ['lora_name', 'lora_model_strength', 'lora_clip_strength'] } })
const any = (t, ...names) => names.includes(t)

/** The capture rule of a node type, or null for one without. */
function rule(t) {
  const text = K('text')
  if (any(t, 'CheckpointLoaderSimple', 'CheckpointLoader', 'CheckpointLoader|pysssss', 'ImageOnlyCheckpointLoader')) return loader('ckpt_name')
  if (any(t, 'UNETLoader', 'Load Diffusion Model', 'UnetLoaderGGUF', 'UnetLoaderGGUFAdvanced')) return loader('unet_name')
  if (t === 'CLIPSetLastLayer') return { clip_skip: CLIP_SKIP }
  if (any(t, 'VAELoader', 'WanVideoVAELoader', 'WanVideoTinyVAELoader')) return { vae: K('vae_name') }
  if (any(t, 'CLIPLoader', 'DualCLIPLoader', 'TripleCLIPLoader', 'TripleClipLoader', 'QuadrupleCLIPLoader', 'QuadrupleClipLoader', 'CLIPLoaderGGUF', 'ClipLoaderGGUF', 'DualCLIPLoaderGGUF', 'DualClipLoaderGGUF', 'TripleCLIPLoaderGGUF', 'TripleClipLoaderGGUF', 'QuadrupleClipLoaderGGUF')) return {}

  if (any(t, 'CLIPTextEncode', 'CLIPTextEncodeSDXLRefiner', 'smZ CLIPTextEncode', 'BNK_CLIPTextEncodeAdvanced', 'Prompt (LoraManager)')) return textRule(text, text)
  if (t === 'CLIPTextEncodeSDXL') return textRule(KS(['text_g', 'text_l']), KS(['text_g', 'text_l']))
  if (t === 'CLIPTextEncodeFlux') return { guidance: K('guidance'), ...textRule(KS(['t5xxl', 'clip_l']), KS(['t5xxl', 'clip_l'])) }
  if (t === 'CLIPTextEncodeHunyuanDiT') return textRule(KS(['mt5xl', 'bert']), KS(['mt5xl', 'bert']))
  if (any(t, 'TextEncodeQwenImageEdit', 'TextEncodeQwenImageEditPlus', 'WanVideoTextEncodeSingle')) return textRule(K('prompt'), K('prompt'))
  if (t === 'TextEncodeQwenImage21') return textRule(K('prompt'), K('negative_prompt'))
  if (t === 'Miaoshouai_Flux_CLIPTextEncode') return { positive: K('caption'), guidance: K('guidance') }
  if (t === 'ImpactWildcardEncode') return { loras: { syntax: ['populated_text', 'wildcard_text'] }, ...textRule(KS(['populated_text', 'wildcard_text']), KS(['populated_text', 'wildcard_text'])) }
  if (any(t, 'WanVideoTextEncode', 'WanVideoTextEncodeCached')) return textRule(K('positive_prompt'), K('negative_prompt'))

  if (any(t, 'KSampler', 'easy fullkSampler', 'easy preSampling', 'easy preSamplingAdvanced', 'easy preSamplingCascade', 'easy preSamplingCustom', 'easy preSamplingDynamicCFG', 'easy preSamplingLayerDiffusion', 'easy preSamplingNoiseIn', 'easy preSamplingSdTurbo', 'KSampler (Efficient)')) return samplerRule()
  if (any(t, 'KSamplerAdvanced', 'KSampler Adv. (Efficient)', 'KSampler SDXL (Eff.)')) return advSamplerRule()
  if (t === 'SamplerCustom') return { seed: K('noise_seed'), cfg: K('cfg') }
  if (t === 'SamplerCustomAdvanced') return {}
  if (t === 'RandomNoise') return { seed: K('noise_seed') }
  if (t === 'KSamplerSelect') return { sampler: K('sampler_name') }
  if (t === 'BasicScheduler') return { steps: K('steps'), scheduler: K('scheduler'), denoise: K('denoise') }
  if (t === 'KarrasScheduler') return scheduled('karras')
  if (t === 'ExponentialScheduler') return scheduled('exponential')
  if (t === 'BetaSamplingScheduler') return scheduled('beta')
  if (t === 'AlignYourStepsScheduler') return { denoise: K('denoise'), ...scheduled('AYS') }
  if (t === 'FluxGuidance') return { guidance: K('guidance') }
  if (any(t, 'CFGGuider', 'PerpNegGuider')) return { cfg: K('cfg') }
  if (t === 'DualCFGGuider') return { cfg: K('cfg_conds') }
  if (any(t, 'Scheduled CFGGuider (Inspire)', 'Scheduled PerpNeg CFGGuider (Inspire)')) return { cfg: K('to_cfg') }
  if (any(t, 'ModelSamplingSD3', 'ModelSamplingAuraFlow')) return { shift: K('shift') }

  if (t === 'LoraLoader') return lorasRule({ inline: ['lora_name', 'strength_model', 'strength_clip'] })
  if (any(t, 'LoraLoaderModelOnly', 'LoraModelLoader')) return lorasRule({ inline: ['lora_name', 'strength_model', 'strength_model'] })
  if (t === 'FluxSettingsNode') return { model: K('model'), guidance: K('guidance'), sampler: K('sampler_name'), scheduler: K('scheduler'), steps: K('steps'), seed: K('noise_seed') }
  if (any(t, 'PCLazyLoraLoader', 'PCLazyLoraLoaderAdvanced')) return lorasRule({ syntax: ['text'] })
  if (any(t, 'LoraLoaderWithPreviews', 'Power Lora Loader (rgthree)')) return lorasRule('rgthree')
  if (any(t, 'easy fullLoader', 'easy comfyLoader')) return fullLoader('ckpt_name', 'clip_skip')
  if (t === 'easy loraStack') return lorasRule('easy')
  if (t === 'Efficient Loader') return { vae: K('vae_name'), ...fullLoader('ckpt_name', 'clip_skip') }
  if (t === 'Eff. Loader SDXL') return { model: K('base_ckpt_name'), clip_skip: K('base_clip_skip'), positive: K('positive'), negative: K('negative') }
  if (t === 'LoRA Stacker') return lorasRule('efficiency')
  if (any(t, 'Lora Loader (LoraManager)', 'LoRA Text Loader (LoraManager)', 'Lora Stacker (LoraManager)', 'WanVideo Lora Select (LoraManager)', 'WanVideo Lora Select From Text (LoraManager)')) return lorasRule('manager')
  if (t === 'Lora Loader Stack (rgthree)') return lorasRule('numbered')
  if (t === 'Power Prompt (rgthree)') return { loras: { syntax: ['prompt', 'text'] }, ...textRule(KS(['prompt', 'positive_prompt']), KS(['prompt', 'negative_prompt'])) }
  if (t === 'SDXL Power Prompt - Positive (rgthree)') return lorasRule({ syntax: ['prompt_g', 'prompt_l'] })
  if (t === 'Power Prompt - Simple (rgthree)') return textRule(KS(['prompt', 'positive_prompt']), KS(['prompt', 'negative_prompt']))
  if (t === 'SDXL Power Prompt - Simple / Negative (rgthree)') return textRule(KS(['prompt_g', 'positive_prompt']), KS(['prompt_g', 'negative_prompt']))
  if (t === 'WanVideoModelLoader') return { model: KS(['model', 'model_b', 'model2']) }
  if (t === 'WanVideoLoraSelect') return lorasRule({ inline: ['lora', 'strength', null] })
  if (t === 'WanVideoLoraSelectByName') return lorasRule({ inline: ['lora_name', 'strength', null] })
  if (t === 'WanVideoLoraSelectMulti') return lorasRule('wanMulti')
  if (any(t, 'LoadWanVideoT5TextEncoder', 'LoadWanVideoClipTextEncoder')) return {}
  if (t === 'WanVideoSampler') return { seed: K('seed'), steps: K('steps'), cfg: K('cfg'), shift: K('shift'), denoise: K('denoise_strength'), scheduler: K('scheduler') }
  if (t === 'WanVideo Sampler') return { seed: K('seed'), steps: K('steps'), cfg: K('cfg'), shift: K('shift'), denoise: K('denoise'), scheduler: K('scheduler') }
  if (any(t, 'ZSamplerTurbo //ZImagePowerNodes', 'ZSamplerTurboAdvanced //ZImagePowerNodes')) return { seed: K('seed'), steps: K('steps'), denoise: K('denoise') }
  if (t === 'ErePromptLoraLoader') return lorasRule('ere')
  if (t === 'ErePromptLoraStack') return lorasRule({ syntax: ['prompt'] })
  return null
}

const POSITIVE_NEGATIVE = new Set(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'ClownsharKSampler', 'ClownsharKSampler_Beta', 'Legacy_SharkSampler', 'UltraSharkSampler', 'UltraSharkSampler Tiled', 'UnsamplerHookProvider', 'KSampler //Inspire', 'KSamplerAdvanced //Inspire', 'KSamplerProgress //Inspire', 'KSamplerAdvancedProgress //Inspire', 'KSamplerWithNAG', 'KSamplerWithNAG (Advanced)', 'SamplerCustomWithNAG', 'KRestartSamplerCustomNoise', 'KSamplerVariationsStochastic+', 'KSamplerVariationsWithNoise+', 'FL_KsamplerPlus', 'FL_KsamplerPlusV2', 'FL_KsamplerBasic', 'FL_FractalKSampler', 'BNK_Unsampler', 'KSampler (WAS)', 'KSampler Cycle', 'KSamplerAdvanced (WLSH)', 'easy fullkSampler', 'KSampler (Efficient)', 'KSampler Adv. (Efficient)', 'KSampler SDXL (Eff.)', 'ZSamplerTurbo //ZImagePowerNodes', 'ZSamplerTurboAdvanced //ZImagePowerNodes'])
const SEARGE = new Set(['SeargeSDXLSampler', 'SeargeSDXLSampler2', 'SeargeSDXLSamplerV3', 'SeargeSDXLImage2ImageSampler', 'SeargeSDXLImage2ImageSampler2'])

/** Samplers' conditioning inputs, positive and negative, where they aren't called that. */
function samplerInputs(t) {
  if (POSITIVE_NEGATIVE.has(t)) return ['positive', 'negative']
  if (t === 'SamplerCustomAdvanced') return ['guider', 'guider']
  if (SEARGE.has(t)) return ['base_positive', 'base_negative']
  if (t === 'FluxSettingsNode') return ['conditioning', 'conditioning']
  if (t === 'WanVideoSampler') return ['text_embeds', 'text_embeds']
  return null
}

/** Guiders whose conditioning inputs don't carry positive and negative names: [positive, negative or null]. */
function guiderInputs(t) {
  if (t === 'DualCFGGuider') return ['cond1', 'negative']
  if (t === 'BasicGuider') return ['conditioning', null]
  return null
}

function isTextEncoder(t) {
  if (any(t, 'CLIPTextEncode', 'CLIPTextEncodeFlux', 'TextEncodeQwenImageEdit', 'TextEncodeQwenImageEditPlus')) return true
  const r = rule(t)
  return !!(r && (r.positive || r.negative)) || ENCODER_NAME.test(t)
}

const ENCODER_TEXT_KEYS = ['text', 'prompt', 'text_g', 't5xxl', 'positive_prompt', 'caption', 'string', 'clip_l', 'text_l']
const ERE_PROMPT = new Set(['ErePrompt', 'ErePromptMultiSelect', 'ErePromptToggle', 'ErePromptCloud', 'ErePromptMultiline', 'ErePromptGallery', 'ErePromptRandomizer', 'ErePromptExtractor'])
// inputs a generic node's single value is read from, most specific first
const VALUE_KEYS = ['value', 'text', 'string', 'prompt', 'populated_text', 'text_g', 't5xxl', 'wildcard_text', 'seed', 'noise_seed', 'int', 'float', 'number', 'boolean']

// ------------------------------------------------------------------ the graph

/** `[node id, output slot]`, or null for a value that isn't a link. */
function link(v) {
  if (!Array.isArray(v) || v.length < 2) return null
  const id = typeof v[0] === 'string' ? v[0] : typeof v[0] === 'number' ? String(v[0]) : null
  if (id === null || !Number.isInteger(v[1])) return null
  return [id, v[1]]
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

class Graph {
  constructor(prompt) {
    this.nodes = new Map()
    for (const [id, n] of Object.entries(prompt)) {
      if (isObject(n) && typeof n.class_type === 'string') this.nodes.set(id, { kind: n.class_type, inputs: isObject(n.inputs) ? n.inputs : {} })
    }
    this.ids = [...this.nodes.keys()].sort((a, b) => {
      const [x, y] = [Number(a), Number(b)]
      return a.trim() !== '' && b.trim() !== '' && !Number.isNaN(x) && !Number.isNaN(y) ? x - y : a < b ? -1 : a > b ? 1 : 0
    })
    this.memo = new Map()
    this.busy = new Set()
    // while set, Prompt Lora Loaders keep their `<lora:>` tags: the prompt as written rather than as encoded
    this.keepLoras = false
  }

  kind(id) {
    return this.nodes.get(id)?.kind ?? ''
  }

  input(id, key) {
    return this.nodes.get(id)?.inputs[key]
  }

  value(v) {
    if (v === undefined) return undefined
    const l = link(v)
    return l ? this.output(l[0], l[1]) : v
  }

  text(v) {
    const x = this.value(v)
    return typeof x === 'string' ? x : typeof x === 'number' ? String(x) : ''
  }

  output(id, slot) {
    const key = `${id}\u0000${slot}\u0000${this.keepLoras}`
    if (this.memo.has(key)) return this.memo.get(key)
    if (!this.nodes.has(id) || this.busy.has(key)) return undefined
    this.busy.add(key)
    const v = this.evaluate(id, slot)
    this.busy.delete(key)
    this.memo.set(key, v)
    return v
  }

  evaluate(id, slot) {
    const n = this.nodes.get(id)
    const i = n.inputs
    const sepValue = this.value(i.separator)
    const sep = typeof sepValue === 'string' ? sepValue : null
    const t = n.kind
    if (ERE_PROMPT.has(t)) return combinePrompt(this.text(i.text), this.text(i.prefix), sep)
    if (t === 'ErePromptComposer') {
      const rows = Object.entries(i)
        .map(([k, v]) => [k.startsWith('row_') && /^\d+$/.test(k.slice(4)) ? Number(k.slice(4)) : null, v])
        .filter(([r]) => r !== null)
        .map(([r, v]) => [r, this.value(v)])
        .filter(([, v]) => typeof v === 'string')
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v)
      const body = rows.length ? joinParts(rows, sep) : this.text(i.text)
      return combinePrompt(body, this.text(i.prefix), sep)
    }
    if (t === 'ErePromptLoraLoader') {
      if (slot !== 2) return undefined
      const [text, prefix] = [this.text(i.text), this.text(i.prefix)]
      // with nothing loaded the node passes its tags through
      const loaded = !this.keepLoras && this.loras(id, 'ere').length > 0
      return loaded ? combinePrompt(stripLoraTags(text), stripLoraTags(prefix), sep) : combinePrompt(text, prefix, sep)
    }
    if (t === 'ErePromptFilter') return this.text(i.prompt)
    if (t === 'StringConcatenate') {
      const d = this.value(i.delimiter)
      return this.text(i.string_a) + (typeof d === 'string' ? d : '') + this.text(i.string_b)
    }
    if (t === 'ImpactWildcardProcessor' || t === 'ImpactWildcardEncode') {
      if (t === 'ImpactWildcardEncode' && slot !== 3) return undefined
      const p = this.text(i.populated_text)
      return p || this.text(i.wildcard_text)
    }
    for (const key of VALUE_KEYS) {
      if (!has(i, key)) continue
      const v = i[key]
      if (link(v)) return this.value(v)
      if (v !== null && v !== '') return v
    }
    const parts = Object.keys(i).filter((k) => NUMBERED_PART.test(k))
    if (parts.length >= 2) {
      parts.sort()
      const dv = this.value(has(i, 'delimiter') ? i.delimiter : i.separator)
      const d = (typeof dv === 'string' ? dv : ', ').replaceAll('\\n', '\n')
      return parts.map((k) => this.text(i[k])).filter((s) => s).join(d)
    }
    return undefined
  }

  /** Upstream node ids, nearest first. */
  upstream(id) {
    const order = []
    const seen = new Set([id])
    const queue = [id]
    while (queue.length) {
      const n = this.nodes.get(queue.shift())
      if (!n) continue
      for (const v of Object.values(n.inputs)) {
        const l = link(v)
        if (l && this.nodes.has(l[0]) && !seen.has(l[0])) {
          seen.add(l[0])
          order.push(l[0])
          queue.push(l[0])
        }
      }
    }
    return order
  }

  field(id, spec) {
    const inputs = this.nodes.get(id).inputs
    const one = (v) => (v === undefined || isNone(v) ? [] : [v])
    if (spec.key) return one(this.value(inputs[spec.key]))
    if (spec.keys) {
      for (const k of spec.keys) {
        if (!has(inputs, k)) continue
        const v = this.value(inputs[k])
        if (v !== undefined && !isNone(v)) return [v]
      }
      return []
    }
    if (spec.value !== undefined) return [spec.value]
    const v = Math.abs(toNumber(this.value(inputs.stop_at_clip_layer), 0))
    return v > 0 ? [v] : []
  }

  loras(id, how) {
    const i = this.nodes.get(id).inputs
    const val = (k) => this.value(i[k])
    const one = (name, strength, clip, hasClip = true) => {
      if (name === undefined || isNone(name) || typeof name !== 'string') return []
      const s = toNumber(strength, 1)
      const c = !hasClip || clip === undefined ? s : toNumber(clip, s)
      return s !== 0 || c !== 0 ? [[name, s]] : []
    }
    const syntax = (keys) => {
      for (const k of keys) {
        const t = this.text(i[k])
        if (t) return loraTags(t).filter(([, s, c]) => s !== 0 || c !== 0).map(([n, s]) => [n, s])
      }
      return []
    }
    if (how.inline) {
      const [name, strength, clip] = how.inline
      return one(val(name), val(strength), clip ? val(clip) : undefined, !!clip)
    }
    if (how.syntax) return syntax(how.syntax)
    if (how === 'rgthree') {
      return Object.entries(i)
        .filter(([k, v]) => k.toLowerCase().startsWith('lora_') && isObject(v) && v.on !== false)
        .flatMap(([, v]) => one(v.lora, v.strength, v.strengthTwo ?? v.strength))
    }
    if (how === 'numbered') {
      return Object.keys(i)
        .filter((k) => /^lora_\d+$/.test(k))
        .flatMap((k) => {
          const n = Number(k.slice(5))
          const s = val(`strength_${String(n).padStart(2, '0')}`)
          return one(val(k), s !== undefined ? s : val(`strength_${n}`), undefined, false)
        })
    }
    if (how === 'efficiency') {
      const count = Math.trunc(toNumber(val('lora_count'), 50))
      const mode = val('input_mode')
      const advanced = typeof mode === 'string' && mode.toLowerCase() === 'advanced'
      const out = []
      for (let n = 1; n <= count && has(i, `lora_name_${n}`); n++) out.push(...(advanced ? one(val(`lora_name_${n}`), val(`model_str_${n}`), val(`clip_str_${n}`)) : one(val(`lora_name_${n}`), val(`lora_wt_${n}`), undefined, false)))
      return out
    }
    if (how === 'easy') {
      if (val('toggle') === false) return []
      const count = Math.trunc(toNumber(val('num_loras'), 10))
      const advanced = val('mode') === 'advanced'
      const out = []
      for (let n = 1; n <= count; n++) out.push(...(advanced ? one(val(`lora_${n}_name`), val(`lora_${n}_model_strength`), val(`lora_${n}_clip_strength`)) : one(val(`lora_${n}_name`), val(`lora_${n}_strength`), undefined, false)))
      return out
    }
    if (how === 'manager') {
      const out = []
      for (let v of Object.values(i)) {
        if (typeof v === 'string' && v.trim().startsWith('[')) {
          try {
            v = JSON.parse(v)
          } catch {
            continue
          }
        }
        if (isObject(v) && Array.isArray(v.__value__)) v = v.__value__
        for (const e of Array.isArray(v) ? v : []) {
          if (!isObject(e) || e.active === false) continue
          const s = e.strength ?? e.model_strength ?? e.weight
          out.push(...one(e.name ?? e.model, s, e.clipStrength ?? e.clip_strength ?? s, true))
        }
      }
      return out.length ? out : syntax(['lora_syntax', 'text', 'loras'])
    }
    if (how === 'wanMulti') {
      const out = []
      for (let n = 0; n < 10 && has(i, `lora_${n}`); n++) out.push(...one(val(`lora_${n}`), val(`strength_${n}`), undefined, false))
      return out
    }
    if (how === 'ere') {
      // nothing loads without a MODEL wired in; the prefix's loras apply first, each once
      if (!link(i.model)) return []
      const seen = new Set()
      const out = []
      for (const k of ['prefix', 'text']) {
        for (const [name, s, c] of loraTags(this.text(i[k]))) {
          const key = modelKey(name)
          if (!seen.has(key)) {
            seen.add(key)
            if (s !== 0 || c !== 0) out.push([name, s])
          }
        }
      }
      return out
    }
    return []
  }

  isSampler(id) {
    const t = this.kind(id)
    if (samplerInputs(t)) return true
    const lower = t.toLowerCase()
    if (!lower.includes('sampler') || lower.includes('select') || lower.includes('scheduler')) return false
    return !!(link(this.input(id, 'positive')) || link(this.input(id, 'guider')))
  }

  /** Text encoders feeding one conditioning branch of a sampler, breadth-first: the nearest, and all of them at that depth. Null when the negative side is zeroed out. */
  trace(sampler, positive) {
    const [p, n] = samplerInputs(this.kind(sampler)) || ['positive', 'negative']
    const out = []
    const start = link(this.input(sampler, positive ? p : n))
    if (!start) return out
    const queue = [[start[0], 0]]
    const seen = new Set()
    let depth = Infinity
    let zeroed = false
    while (queue.length) {
      const [id, d] = queue.shift()
      if (d > depth || seen.has(id)) continue
      seen.add(id)
      const node = this.nodes.get(id)
      if (!node) continue
      if (!positive && node.kind === 'ConditioningZeroOut') {
        zeroed = true
        continue
      }
      if (isTextEncoder(node.kind)) {
        out.push(id)
        depth = d
        continue
      }
      const guider = guiderInputs(node.kind)
      if (guider) {
        const k = positive ? guider[0] : guider[1]
        const next = k ? link(node.inputs[k]) : null
        if (next) queue.push([next[0], d + 1])
        continue
      }
      const [mine, other] = positive ? ['positive', 'negative'] : ['negative', 'positive']
      const matches = (name, b) => {
        const lower = name.toLowerCase()
        return lower === b || lower.startsWith(`${b}_`) || lower.endsWith(`_${b}`)
      }
      const linked = Object.entries(node.inputs).map(([k, v]) => [k, link(v)]).filter(([, l]) => l).map(([k, l]) => [k, l[0]])
      const routed = linked.filter(([k]) => matches(k, mine))
      const hasOther = linked.some(([k]) => matches(k, other))
      for (const [, next] of routed.length && hasOther ? routed : linked) queue.push([next, d + 1])
    }
    return zeroed && !out.length ? null : out
  }

  encoderText(id, positive) {
    const r = rule(this.kind(id))
    const spec = (r && (positive ? r.positive : r.negative)) || KS(ENCODER_TEXT_KEYS)
    return this.field(id, spec).find((v) => typeof v === 'string') ?? ''
  }

  branchText(ids, positive) {
    const texts = []
    for (const id of ids) {
      const t = this.encoderText(id, positive).trim()
      if (t && !texts.includes(t)) texts.push(t)
    }
    return texts.join('\n\n')
  }

  /** Every node reachable from some `negative` input. */
  negativeSide() {
    const out = new Set()
    const stack = this.ids.map((id) => link(this.input(id, 'negative'))).filter((l) => l).map((l) => l[0])
    while (stack.length) {
      const id = stack.pop()
      const n = this.nodes.get(id)
      if (!n || out.has(id)) continue
      out.add(id)
      for (const v of Object.values(n.inputs)) {
        const l = link(v)
        if (l) stack.push(l[0])
      }
    }
    return out
  }
}

const plain = (v) => v !== undefined && !isObject(v) && !Array.isArray(v)

/** Reads an executed graph: `{ positive, negative, params: [[key, value]], model, vae, loras: [[name, strength]] }`, or null when it has no nodes. */
export function analyze(prompt) {
  if (!isObject(prompt)) return null
  const g = new Graph(prompt)
  if (!g.nodes.size) return null
  const samplers = g.ids.filter((id) => g.isSampler(id))
  const upstream = new Map(samplers.map((id) => [id, new Set(g.upstream(id))]))
  // the first pass: a hires or refiner pass has the earlier sampler upstream of it
  const first = samplers.filter((id) => !samplers.some((o) => o !== id && upstream.get(id).has(o)))
  let primary = null
  let branches = null
  for (const id of first) {
    const pos = g.trace(id, true) || []
    if (!pos.length && primary !== null) continue
    primary = id
    branches = [pos, g.trace(id, false)]
    if (pos.length) break
  }
  const out = { positive: '', negative: '', params: [], model: null, vae: null, loras: [] }
  if (branches && branches[0].length) {
    out.positive = g.branchText(branches[0], true)
    out.negative = branches[1] ? g.branchText(branches[1], false) : ''
  } else {
    // no sampler routing to follow: the first wired encoder outside the negative side is the prompt
    const negatives = g.negativeSide()
    const wired = new Set(g.ids.flatMap((id) => Object.values(g.nodes.get(id).inputs).map(link).filter((l) => l).map((l) => l[0])))
    const encoders = g.ids.filter((id) => wired.has(id) && isTextEncoder(g.kind(id)))
    const p = encoders.find((id) => !negatives.has(id) && g.encoderText(id, true))
    if (p) out.positive = g.branchText([p], true)
    const n = encoders.find((id) => negatives.has(id) && g.encoderText(id, false))
    if (n) out.negative = g.branchText([n], false)
  }
  if (out.negative === out.positive) out.negative = ''

  const scope = primary !== null ? [primary, ...g.upstream(primary)] : [...g.ids]
  for (const key of PARAM_KEYS) {
    for (const id of scope) {
      const spec = rule(g.kind(id))?.[key]
      const v = spec ? g.field(id, spec).find(plain) : undefined
      if (v !== undefined) {
        out.params.push([key, v])
        break
      }
    }
  }
  // custom samplers and schedulers without a rule still name their inputs the usual way
  for (const [key, names] of GENERIC_PARAMS) {
    if (out.params.some(([k]) => k === key)) continue
    for (const id of scope) {
      if (rule(g.kind(id))) continue
      const v = g.field(id, KS(names)).find((x) => plain(x) && typeof x !== 'boolean')
      if (v !== undefined) {
        out.params.push([key, v])
        break
      }
    }
  }

  const firstName = (vs) => vs.find((v) => typeof v === 'string') ?? null
  for (const id of [...scope, ...g.ids]) {
    const r = rule(g.kind(id)) || {}
    const spec = r.model || (r.loras ? null : KS(['ckpt_name', 'unet_name']))
    const name = spec ? firstName(g.field(id, spec)) : null
    if (name !== null) {
      out.model = name
      break
    }
  }
  const seen = new Set()
  // reversed: the loader nearest the sampler applies last
  for (const id of [...scope].reverse()) {
    const r = rule(g.kind(id))
    let list
    if (r?.loras) list = g.loras(id, r.loras)
    else if (!r && g.kind(id).toLowerCase().includes('lora') && has(g.nodes.get(id).inputs, 'lora_name')) list = g.loras(id, { inline: ['lora_name', 'strength_model', 'strength_clip'] })
    else continue
    for (const [name, s] of list) {
      const key = modelKey(name)
      if (!seen.has(key)) {
        seen.add(key)
        out.loras.push([name, s])
      }
    }
  }
  // the VAE that decoded the image sits downstream of the sampler, so it is found from the decoders
  const decoders = g.ids.filter((id) => g.kind(id).toLowerCase().includes('vaedecode')).map((id) => link(g.input(id, 'vae'))).filter((l) => l).map((l) => l[0])
  for (const id of [...decoders, ...scope, ...g.ids]) {
    const spec = rule(g.kind(id))?.vae
    const name = spec ? firstName(g.field(id, spec)) : null
    if (name !== null) {
      out.vae = name
      break
    }
  }
  return out
}
