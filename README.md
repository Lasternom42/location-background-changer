# Location Background Manager

This SillyTavern extension ties backgrounds, music, and weather to individual lorebook entries.

## How it works

1. Select a lorebook in the extension panel.
2. See all entries from that lorebook.
3. Add a background, music, or weather value to any entry.
4. When that entry becomes active, the extension applies the linked background and emits a change event for the extra fields.

## Installation

Copy the `location-background` folder into your third-party extensions directory and install it in SillyTavern.

The extension is designed for SillyTavern `1.18.x`.

## In The Panel

- Pick a lorebook first.
- Use the three buttons on each entry to add `Background`, `Music`, or `Weather`.
- Use the small `x` buttons to remove a single mapping.
- Use the trash button to remove all mappings for an entry.
- Reload the lorebook list or the selected lorebook whenever you change things in SillyTavern.

## Runtime

Only `background` is applied directly right now. `music` and `weather` are stored with the entry and exposed through the `location-background:changed` browser event so they can be wired up later without changing the structure again.

## Debug

In the browser console:

```js
locationBackgroundManager.reload()
locationBackgroundManager.selectWorld("West Tower")
locationBackgroundManager.getState()
```
