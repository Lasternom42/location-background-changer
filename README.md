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
- Use `Location Prompt Insert` to inject narrator location rules without editing character cards.
- Use the trash button to remove a location entry from the manager.
- Enable `Debug` to show lorebook counts, status, and last applied details.
- Reload the lorebook list or the selected lorebook whenever you change things in SillyTavern.

## Location Prompt Insert

The prompt injector is extension-driven. It uses the selected lorebook and only the location entries you added under `Locations`.

Settings:

- `Use prompt injector`: Enables or disables prompt injection.
- `Location prompt`: The editable base instruction sent before generation.
- `Current location block`: Always added when a current location is known. Supports `{{currentLocation}}`.
- `Include connected locations`: Enables the connected locations block and its `Max locations` limit. Supports `{{connectedLocations}}`.
- `Connected locations block`: Editable prompt text for nearby node choices and lorebook format guidance.
- `Include aliases`: Enables the aliases block. Supports `{{aliases}}`.
- `Aliases block`: Editable prompt text for alias handling and lorebook format guidance.
- `Allow multi-hop location changes`: Enables the multi-hop block.
- `Multi-hop block`: Editable prompt text for movement through multiple connected spaces.
- `Max locations`: Limits how many connected-location choices are injected, keeping the prompt compact.
- `Prompt depth`: Passed to SillyTavern's extension prompt hook. It controls where this extension prompt is placed in the final prompt stack; `0` is the safest default.
- `Prompt Preview`: Visible when `Debug` is enabled and shows the final injected text.

Disabled prompt options grey out their text block but keep the custom text saved.

Default base prompt:

```text
Choose the current location from the selected lorebook location entries only.
Never invent new location names.
End every narrator reply with:
Location: Exact Location Node Name
Choose exactly one existing location name from the locations above.
If the scene changed, output the new exact node name.
If not, repeat the same current location.
Use aliases to convert scene wording to the exact location node name.
If uncertain, keep the previous exact location.
```

Example final injected prompt:

```text
Choose the current location from the selected lorebook location entries only.
Never invent new location names.
End every narrator reply with:
Location: Exact Location Node Name
Choose exactly one existing location name from the locations above.
If the scene changed, output the new exact node name.
If not, repeat the same current location.
Use aliases to convert scene wording to the exact location node name.
If uncertain, keep the previous exact location.

Current scene context:
- Current location: West Tower Entrance

Connected locations:
- West Tower Forest
- West Tower Observation Deck
```

Editable block placeholders:

```text
{{currentLocation}}
{{connectedLocations}}
{{aliases}}
```

Optional lorebook entry sections:

```text
Aliases:
- outside the west tower
- tower approach

Connected locations:
- West Tower Forest
- West Tower Observation Deck
```

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
locationBackgroundManager.getPrompt()
locationBackgroundManager.refreshPrompt()
locationBackgroundManager.getState()
```
