# Location Background Manager

This SillyTavern extension ties backgrounds to individual lorebook entries.

## How it works

1. Select a lorebook in the extension panel.
2. In `Locations`, choose a lorebook entry from the dropdown.
3. Press `+` to add that entry as a managed location.
4. Pick or type a background filename for that location.
5. When that entry becomes active, the extension applies the linked background.

## Installation

Copy the `location-background` folder into your third-party extensions directory and install it in SillyTavern.

The extension is designed for SillyTavern `1.18.x`.

## In The Panel

- Pick a lorebook first.
- Under `Locations`, select a lorebook entry and press `+`.
- Use the background dropdown to pick from current SillyTavern backgrounds.
- Use the trash button to remove a location entry from the manager.
- Enable `Debug` to show lorebook counts, status, and last applied details.
- Reload the lorebook list or the selected lorebook whenever you change things in SillyTavern.

## Runtime

The selected `background` is applied directly with `/bg`. The extension also emits a `location-background:changed` browser event so later music, weather, or ambient effects can be added without changing the basic structure again.

## Debug

In the browser console:

```js
locationBackgroundManager.reload()
locationBackgroundManager.selectWorld("West Tower")
locationBackgroundManager.getState()
```
