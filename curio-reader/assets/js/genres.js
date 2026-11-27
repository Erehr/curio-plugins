// The Genres widget: the selected book's or comic's genres as chips, as the Tags widget shows tags; read from its file, so not changed here; a click shows All with that genre.
const curio = Curio.connect()

let current = null

async function show(id) {
  current = id
  const it = await curio.item.get({ id }).catch(() => null)
  if (current !== id) return
  const g = it?.fields?.genre
  const genres = Array.isArray(g) ? g : g ? [g] : []
  document.body.replaceChildren(...genres.map((label) => {
    const chip = Object.assign(document.createElement('button'), { type: 'button', className: 'chip chip-link', textContent: label })
    chip.addEventListener('click', () => curio.view.showWith({ field: 'genre', value: label }).catch(() => {}))
    return chip
  }))
  // nothing to show without genres, so the widget hides
  document.body.hidden = !genres.length
}

curio.on('plugin.selection', ({ data }) => data.item && show(data.item.id))
curio.on('items.changed', ({ data }) => current && data.ids?.some((i) => String(i) === String(current)) && show(current))
