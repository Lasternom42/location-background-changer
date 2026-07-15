# SillyTavern Location Background Manager

Automatically changes the SillyTavern background when a matching Lorebook / World Info entry becomes active.

## How it works

1. SillyTavern activates one or more World Info entries.
2. The extension reads each entry's **Entry Title / Memo** field (`comment` internally).
3. It looks for that title in `locations.json`.
4. If a match has a `background`, it runs the same background flow as `/bg "filename.png"`.

If the title is empty, the extension also checks the entry's primary keys as a fallback.

## Install

Copy the `location-background` folder into your SillyTavern extensions folder:

```text
SillyTavern/data/<user-handle>/extensions/location-background
```

For local development or all-user installs, you can also place it here:

```text
SillyTavern/public/scripts/extensions/third-party/location-background
```

Restart or reload SillyTavern, then enable **Location Background Manager** in the extensions panel.

## Background files

Put your images in SillyTavern's normal background folder, or upload them from the Backgrounds panel:

```text
SillyTavern/public/backgrounds
```

The filenames in `locations.json` must match the background filenames.

## locations.json

Simple format:

```json
{
  "West Tower": "West_tower.png",
  "East Tower": "East_tower.png"
}
```

Expandable format:

```json
{
  "West Tower": {
    "background": "West_tower.png",
    "music": "westtower.mp3",
    "weather": "fog"
  }
}
```

Only `background` is applied by this version. Extra fields such as `music` and `weather` are preserved and emitted through the browser event `location-background:changed`, so later versions or companion extensions can react to them.

## Example

If your active World Info entry has this title:

```text
West Tower
```

And `locations.json` contains:

```json
{
  "West Tower": "West_tower.png"
}
```

The extension applies:

```stscript
/bg "West_tower.png"
```

## Debug

Open the browser console in SillyTavern and run:

```js
locationBackgroundManager.reload()
```

This reloads `locations.json` without restarting SillyTavern.

## Settings panel

After installation, open SillyTavern's **Extensions** panel and look for **Location Background Manager**.

The panel lets you:

- Enable or disable automatic background changes.
- Choose whether to match World Info Entry Title / Memo.
- Choose whether primary keys are used as a fallback.
- Reload `locations.json` without restarting SillyTavern.
- Apply a selected location manually for testing.
- See all loaded location mappings.
