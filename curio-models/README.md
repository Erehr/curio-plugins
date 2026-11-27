# 3D models

3D models are shown and read by this plugin, from Curio's plugins repository: add the repository's folder in Curio's Settings › Plugins and switch it on. Without it, model files still come into the library, without its thumbnails or fields. Blender (`.blend`) and Cinema 4D (`.c4d`) files are a family of Curio's own, *3D scenes*, shown by the preview they carry.

| Files | Read |
|---|---|
| STL, binary and ASCII | the triangles; a binary STL's colours |
| 3MF | the objects on the build plate, placed as the file places them; colours, materials and textures in the package |
| OBJ | with its `.mtl` and the pictures it names |
| glTF: GLB, and `.gltf` with its `.bin` and pictures | materials and textures; Draco and meshopt compression |
| PLY, binary and ASCII | faces, or points when it has none; a colour at each vertex |

FBX, 3DS, COLLADA (`.dae`) and IFC files come in as 3D models without a thumbnail of the plugin's.

## Files that belong to a model

An OBJ's `{name}.mtl` and a glTF's `{name}.bin` are grouped into the model ([Grouped files](../../app/docs/plugins/manifest.md#grouped-files)): they don't show as items of their own and move with the model. The pictures a model uses are looked for beside it, in its folder and the folders under it (`textures/wood.png`), and stay items of their own, since one picture often serves several models. A path the model was saved with on another computer (`C:\work\wood.png`) is looked for by its name beside the model. Pictures grouped into a model by hand (*Group as one item*) are found by name wherever they are.

## Thumbnails

The model from above, the front and the left, fitted to the picture, on a transparent background, so it sits on the card's own colour in every theme. A model without colours or materials of its own is drawn in grey. STL, 3MF and PLY files stand with Z up, as CAD programs and slicers write them; glTF and OBJ with Y up.

The plugin draws them in a page, as every [thumbnail page](../../app/docs/plugins/pages.md#a-thumbnail-page) does, so they are made while a window is open; models added to a library no window shows wait for one. Files over 256 MB, and models of more than 20 million triangles, get none; over 5 million triangles they are drawn at the thumbnail's size without smoothing. A 3MF that unpacks to more than 1 GB isn't read.

## Viewer

A model opens in the plugin's viewer, on a screen of its own in the layout editor (*3D models*), with the *3D model* widget in its Inspector. It opens from above, the front and the left, the whole model in sight, standing on a floor grid; a model you turned opens again as you left it. The background is the theme's, and a model without colours of its own is drawn in the theme's text colour.

| Mouse | Does |
|---|---|
| Left drag | turns the model around its centre |
| Right or middle drag, Shift with the left | moves it |
| Wheel | zooms toward the pointer |
| Double click | fits it again |

Its tools are buttons in Curio's toolbar, with keys ([keyboard-and-mouse.md](../../app/docs/keyboard-and-mouse.md#3d-model-viewer)): *Fit*, *Floor grid*, *Edges* (creases sharper than 20°), *Textures* (shown for a model that has pictures), *Details*, and *Appearance*: *Shading* (*Materials* as the file has them, *Plain* in the text colour, *Normals* colouring each face by the way it faces, which shows the shape and faces turned inside out, *Wireframe*), *Light*, and *Up* (*Auto*, Y or Z) for a model that lies on its side, kept with the model. The grid, edges, textures, details, shading and light are kept for the next model.

*Details* lists the triangles, the vertices (corners at one place counted once), the size as the fields have it, the volume of a closed model, its surface area (in cm³ and cm² for a model in millimetres), its meshes, materials and textures, and the textures it names that weren't found. Volume and surface area aren't worked out for models of more than 2 million triangles. Above 5 million triangles the viewer draws at the screen's own pixels without gliding, and *Edges* isn't offered. Files over 512 MB aren't opened.

## Fields

Read from each model when it comes in or changes, and when *Rescan* asks, by a hidden page that loads the model as the viewer does ([an extractor page](../../app/docs/plugins/extractors.md#a-page)), so they are read while a window is open:

| Field | Key | From |
|---|---|---|
| Triangles | `model_triangles` | the faces, a four-sided one counted as two; each object counted as many times as the file places it |
| Width (mm), Depth (mm), Height (mm) | `model_width`, `model_depth`, `model_height` | the box around the model in millimetres, height along the axis the file stands on; a 3MF's unit (millimetres unless it says) and glTF's metres are turned into millimetres, and a file without a unit (STL, OBJ, PLY) is taken as millimetres, as STL files for printing are made |
| Model unit | `model_unit` | the unit the file declares: µm, mm, cm, m, in or ft; empty for STL, OBJ and PLY |
| Textured | `model_textured` | pictures in its materials; for an OBJ, only known when its `.mtl` is grouped in |
| Vertices | `model_vertices` | the distinct corners, those at one place counted once; not counted past 10 million corners. Not kept unless switched on in Settings › Fields |
| Objects | `model_objects` | the meshes the model loads as: an OBJ's objects or groups, a 3MF's or a glTF's meshes as placed, one for STL and PLY. Not kept unless switched on in Settings › Fields |

`height >= 100` asks of pictures; `model_height >= 100` of models taller than 10 cm. Files over 512 MB are left without these fields. Sort by *Triangles*; *Textured models* is a filter of the plugin's, and *Model size (mm)* filters the width, depth and height together, with a range for each. The *3D model* widget shows the fields in the Inspector.
