# Recorded narration

A worker must be able to finish a drill without reading a word. Today that promise is kept by the
handset's own speech synthesis, which is a stand-in: the Hindi voice is mechanical, quality varies
by handset, and **Santali has no voice at all**, so an Ol Chiki line is simply never spoken (the app
stays silent rather than handing Ol Chiki to a Devanagari voice, which would be noise).

The app already prefers a recording wherever one exists. Nothing is recorded yet. This is how to
record it.

## How the app decides what to play

1. A line's clip id is in the scenario JSON, as `audio` beside `text`, one per language.
2. On startup the app reads `public/narration/manifest.json`, the list of clips that actually exist.
3. When a line is spoken, the app plays `narration/<id>.mp3` if that id is in the manifest, else it
   falls back to the handset voice. A clip that fails to play (missing file, codec, autoplay policy)
   also falls back rather than leaving the learner with silence.
4. Language follows the same fallback chain as the text: a Santali learner hears the Santali clip if
   there is one, otherwise the Hindi clip, matching the Hindi line already on their screen.

The manifest is what keeps a phone with the radio off from spending a failed request on every line.
The service worker caches each clip the first time it plays, so a drill run once online runs with
its narration offline afterwards.

## Recording

```bash
node tools/narration.mjs --report                          # what exists, per scenario and language
node tools/narration.mjs --script --lang hi > sheet.tsv     # the lines to read, with their filenames
# record each line, then:
node tools/narration.mjs --manifest --apply                 # rebuild the manifest from the files
```

- One file per line, at `public/narration/<id>.mp3`. The recording sheet gives the exact filename.
- Mono is fine. Phone-recorded is fine. A quiet room matters more than the microphone.
- Read the line as written. If a line is wrong in your language, fix the scenario text and record
  the corrected line, rather than reading something different from what is on the screen.
- Santali first if you have a Santali speaker: it is the language with no alternative. Hindi second.
  English is not recorded, since it is the written fallback the other two fall back to.

## Lines that stay synthetic

Some lines contain a variant placeholder, such as "belt {{belt}} has jammed". One recording would
name belt C3 on a drill about belt C4, which is worse than a synthetic voice naming the right one.
The tool refuses to give those lines a clip id, `--report` counts them separately, and a test
(`tests/narration.test.ts`) fails if one ever gets an id. Today that is 6 lines in the gas drill and
9 in the conveyor drill, per language.

If recorded narration for those lines matters later, the fix is in the authoring: split the line so
the varying part is a separate, short clip, or phrase it without the placeholder.

## Adding or renaming a line

Clip ids are derived from the scenario and node ids, never typed by hand, so a renamed node cannot
quietly keep pointing at the old recording. After any scenario edit:

```bash
node tools/narration.mjs --ids --apply
node tools/narration.mjs --report
```

A renamed node shows up as an unrecorded line, and its old file is simply no longer referenced.
