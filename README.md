<div align="center">
  <img src=".github/logo.svg" alt="Curio logo" width="76" height="76" />
  <h1>Curio Plugins</h1>
  <p><strong>Official optional plugins for Curio.</strong><br />Ebooks, PDFs &amp; comics reader, interactive 3D model viewer, and AI generation metadata &amp; model manager — built on Curio's public API and plugin pages.</p>

  <p>
    <img src="https://img.shields.io/badge/license-GPL--3.0-3B9160?style=flat-square" alt="License: GNU GPL v3" />
    <img src="https://img.shields.io/badge/plugins-3%20official-2b2f36?style=flat-square" alt="3 official plugins" />
    <img src="https://img.shields.io/badge/Curio-Plugin%20API%20v1-2b2f36?style=flat-square" alt="Curio Plugin API v1" />
    <img src="https://img.shields.io/badge/network-none%20required-3B9160?style=flat-square" alt="Offline only" />
  </p>

  <p>
    <a href="#included-plugins">Included Plugins</a> &middot;
    <a href="#installation">Installation</a> &middot;
    <a href="#permissions">Permissions</a> &middot;
    <a href="#building-plugins">Building Plugins</a> &middot;
    <a href="#credits-and-license">License</a>
  </p>
</div>

---

## Overview

Each top-level directory in this repository is a standalone plugin for [**Curio**](https://github.com/Erehr/curio). All three are built solely on Curio's public API, declarative `plugin.json` manifest, and sandboxed plugin pages — nothing inside Curio depends on them. Without them, Curio still indexes these files normally with standard thumbnails and built-in properties; enabling a plugin adds rich viewers, custom thumbnailers, metadata extraction, Inspector widgets, and search filters.

---

## Included Plugins

| Plugin | Folder | Formats | Highlights |
|---|---|---|---|
| **Reader** | [`curio-reader`](curio-reader/) | `epub`, `pdf`, `mobi`, `azw3`, `azw`, `prc`, `fb2`, `fbz`, `cbz`, `cb7` | Full book, PDF & comic viewer, layouts & RTL spreads, bookmarks, reading progress, 14 indexed fields, Book/Series/Genres Inspector widgets. |
| **3D Models** | [`curio-models`](curio-models/) | `stl`, `3mf`, `obj` (`+ .mtl`), `gltf` (`+ .bin`), `glb`, `ply` | Interactive Three.js viewer & thumbnail renderer, orbit/grid/wireframe/texture controls, triangle/size/unit fields, grouped `Model size (mm)` filter. |
| **AI Generation** | [`curio-ai-generated`](curio-ai-generated/) | Images (`png`, `jpg`, `webp`, `heic`, `avif`, RAW…) & models (`safetensors`, `sft`, `ckpt`, `gguf`) | Extracts A1111/Forge, ComfyUI & NovelAI prompts/LoRAs, groups model previews & Civitai sidecars, reverse-searches matching images from a model file. |

### Reader (`curio-reader`)
- **Unified reading experience**: Read EPUB, MOBI, AZW3, FB2, PDF, and CBZ/CB7 comic archives inside Curio's viewer with single-page, double-page spread, continuous scroll, right-to-left (manga) mode, comic page grids, in-book search, table of contents, footnotes, and bookmarks.
- **Reading tracker & metadata**: Automatically extracts `title`, `author`, `series`, paired `series_index`, `pages`, `words`, `published`, `publisher`, `language`, `isbn`, `identifiers`, and `genre`, plus tracks `read_state` and `read_progress` per file.
- **Inspector widgets**: Adds **Book**, **Series**, and **Genres** widgets alongside Curio's built-in metadata.

### 3D Models (`curio-models`)
- **Interactive viewport & thumbnails**: Renders 3D thumbnails automatically and opens an interactive orbit viewer with floor grid, edge/wireframe overlay, texture toggling, lighting/shading presets, and fit-to-view controls.
- **Automatic companions**: Groups `.obj` files with sibling `.mtl` material files and `.gltf` files with sibling `.bin` buffers into a single asset.
- **Geometry metadata**: Indexes `model_triangles`, `model_width`, `model_depth`, `model_height` (grouped under **Model size (mm)** in the Filter bar), `model_unit`, `model_textured`, plus optional `model_vertices` and `model_objects`. See [`curio-models/README.md`](curio-models/README.md) for format details.

### AI Generation (`curio-ai-generated`)
- **Prompt & parameter extraction**: Reads generation parameters embedded by Stable Diffusion WebUI (A1111, Forge), ComfyUI, and NovelAI into `prompt`, `negative_prompt`, `model`, `model_hash`, `vae`, paired `lora` + `lora_strength`, `sampler`, `scheduler`, `steps`, `cfg`, `seed`, `denoise`, `clip_skip`, and `software`.
- **Model weight management**: Recognizes `.safetensors`, `.sft`, `.ckpt`, and `.gguf` files, groups sibling preview images (as cover) and Civitai JSON metadata sidecars, and indexes `model_type`, `base_model`, `model_version`, `creator`, and `trigger_words`.
- **Cross-lookup**: Opening a checkpoint or LoRA file jumps straight to all images in your library generated with that model (`open.show_with`).

---

## Installation

You can install individual plugins directly from a cloned checkout or downloaded release archive:

1. Open **Settings › Plugins** in Curio.
2. Click **Add plugin folder** and select one of the plugin directories containing `plugin.json` (`curio-reader`, `curio-models`, or `curio-ai-generated`).
3. Curio registers the folder, enables the plugin for the active library, and grants its declared permissions.
4. For existing libraries, expand the plugin row in **Settings › Plugins** and click **Read missing** to extract metadata and generate thumbnails for files already in the library.

Alternatively, copy any plugin directory (`curio-reader/`, `curio-models/`, `curio-ai-generated/`) into:
- **App plugins folder** (available to all libraries): `%APPDATA%\Curio\plugins` (Windows) or `~/.local/share/Curio/plugins` (Linux).
- **Library plugins folder** (travels with a library): `<Library>.curio/plugins/`.

---

## Permissions

Every plugin runs inside Curio's sandboxed `plugin://` runtime with zero network access and zero external process execution:

| Plugin | Permissions requested in `plugin.json` | Network / Exec |
|---|---|---|
| `curio-reader` | `metadata.read`, `metadata.write`, `files.read`, `files.write`, `ui` | None |
| `curio-models` | `metadata.read`, `metadata.write`, `files.read`, `ui` | None |
| `curio-ai-generated` | `files.read` | None |

You can review or restrict any permission per library by expanding the plugin row in **Settings › Plugins**.

---

## Building Plugins

These three plugins also serve as real-world references for Curio's plugin platform — custom viewers, toolbar controls (`viewer_tools` / `viewer_keys`), page thumbnailers, page extractors, companion file grouping, paired custom fields, and Inspector widgets. See Curio's [Plugins documentation](https://erehr.github.io/curio/plugins/) for the complete manifest, hooks, and plugin page reference.

## Related Repositories

- [**Erehr/curio**](https://github.com/Erehr/curio) — Curio desktop app and [documentation](https://erehr.github.io/curio/).
- [**Erehr/curio-extension**](https://github.com/Erehr/curio-extension) — **Send to Curio** browser extension for Chromium browsers.

---

## Credits and License

All plugins in this repository are free software under the **GNU General Public License v3.0** ([LICENSE](LICENSE)), matching Curio itself. Vendored third-party libraries retain their own licenses, included inside each plugin's `assets/vendor/` directory:

| Library | Used in | License |
|---|---|---|
| [pdf.js](https://mozilla.github.io/pdf.js/) | `curio-reader` | Apache-2.0 |
| [foliate-js](https://github.com/johnfactotum/foliate-js) | `curio-reader` | MIT |
| [three.js](https://threejs.org/) | `curio-models` | MIT |
