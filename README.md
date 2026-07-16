# Location Background Manager

This SillyTavern extension ties backgrounds to individual lorebook entries.

## How it works

1. Select a lorebook in the extension panel.
2. In `Locations`, choose a lorebook entry from the dropdown.
3. Press `+` to add that entry as a managed location.
4. Pick a background filename for that location.
5. When a chat message contains `[LBM_LOCATION: Location Name]`, the extension applies the linked background.

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

The selected `background` is applied directly with `/bg`. By default, the extension only switches when it sees an explicit location marker such as `[LBM_LOCATION: West Tower]`. This prevents normal mentions of a location from changing the background. The extension also emits a `location-background:changed` browser event so later music, weather, or ambient effects can be added without changing the basic structure again.

## Location Marker

Use this marker in assistant output or a reasoning/Stepped Thinking extension:

```text
[LBM_LOCATION: West Tower]
```

You can also place it in a hidden HTML comment: `<!-- [LBM_LOCATION: West Tower] -->`.

The location name must match one of the entries you added under `Locations`.

If no marker is present, the extension also checks the last few lines for a configured location name. This supports narrator endings like:

```text
Location: West Tower Entrance
```

or:

```text
West Tower - Observation Deck
```

## Debug

In the browser console:

```js
locationBackgroundManager.reload()
locationBackgroundManager.selectWorld("West Tower")
locationBackgroundManager.setMarkerDetection(true)
locationBackgroundManager.setLorebookActivation(false)
locationBackgroundManager.testText("Location: West Tower Entrance")
locationBackgroundManager.getState()
```
