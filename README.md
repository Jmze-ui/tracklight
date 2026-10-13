# Tracklight

A tracker module (`.mod`) player and editor that runs in the browser. One HTML file, no dependencies, no build step.

It plays 4 to 32 channel ProTracker-style modules and the older 15-sample NoiseTracker and Soundtracker files, with a pattern editor, a sample editor, a playlist, project files, and an export that turns a song into a self-contained player page.

## Run it

You need [Node.js](https://nodejs.org/) 18 or newer. Nothing else is installed.

```bash
node serve.js                  # start a local server and open a window
node serve.js "my song.mod"    # open a song straight away
node serve.js project.tlp      # or a saved project
```

On Windows you can double-click `tracklight.cmd` or run it from a prompt (`.\tracklight.cmd song.mod`). To get a plain `tracklight` command anywhere, run `npm link` once in this folder.

The launcher listens on `127.0.0.1` only and serves just the app and the one file you name. It opens a standalone window if Edge or Chrome is installed, otherwise your default browser, and quits when you close the window. Options: `--port N`, `--no-browser`, `--keep`, `--browser PATH`, `--help`.

You can also serve the folder with any static server (for example `python -m http.server`) and open `index.html` over `http://localhost`. A plain `file://` page is not recommended: folder access and MIDI need a secure context.

## What it does

- **Playback:** a ProTracker 2.3 style replayer in an AudioWorklet. Amiga 500 (low-pass filter), Amiga 1200 and Clean (interpolated) sound modes, adjustable stereo width, and Soundtracker effect mode for 15-sample files.
- **Pattern editor:** note and hex entry, selection, copy and paste, undo, transpose, order list editing, and MIDI keyboard input (Web MIDI).
- **Sample editor:** waveform, loop points, crop, cut, reverse, fade, normalize, WAV import and export.
- **Song tools:** song length and a tempo map, loop regions, swing and groove, a master level meter and spectrum, a playlist with shuffle and repeat.
- **Disk Op:** browse a folder, audition samples, load and save IFF 8SVX, WAV and raw samples, modules and projects.
- **Projects:** one `.tlp` file holds the playlist, your edits and the song-shaping settings.
- **Standalone player export:** a single `.html` file with the song and the engine inside, playable offline.
- **Tutorial:** a guided tour for new users. Press `?` for every keyboard shortcut.

## Browser support

Chrome and Edge give the full feature set. Firefox plays and edits everything, but has no folder picker, so Disk Op falls back to a read-only folder upload (saves download instead).

## Known limits

- Playback follows ProTracker 2.3 behaviour but is not bit-exact with real Paula hardware. The finetune period table is calculated, so a few values can differ by 1 from the original table.
- `E3` (glissando), `EF` (invert loop) and `8xx` (pan) are ignored, as in plain ProTracker. `FLT8` modules and compressed (Fibonacci) 8SVX samples are not supported.
- MED, XM, S3M and IT formats are not supported.
- Browsers hold audio until the first click, so you may need to press Play once.

## Tests

```bash
npm test            # or: node test.js && node test-serve.js
```

`test.js` checks the engine, formats and editing logic. `test-serve.js` checks the launcher, including that it never serves anything but the app and the named file.

## Names

ProTracker, NoiseTracker, OctaMED and Amiga are names of other people's products and trademarks of their owners. They are used here only to say which formats and behaviours this software is compatible with. This project is not affiliated with or endorsed by them.

## Licence

[MIT](LICENSE). The playback engine is embedded in every exported player page, and its copyright notice goes with it.
