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
- Set a `Start location` for chats that have no saved or detectable location yet.
- Use `Location Prompt Insert` to inject narrator location rules without editing character cards.
- Use the trash button to remove a location entry from the manager.
- Enable `Debug` to show lorebook counts, status, and last applied details.
- Reload the lorebook list or the selected lorebook whenever you change things in SillyTavern.

## Location Prompt Insert

The prompt injector is extension-driven. It uses the selected lorebook and only the location entries you added under `Locations`.

Settings:

- `Use prompt injector`: Enables or disables prompt injection.
- `Location line format`: Selects visible `Location: ...` output or hidden HTML comment output.
- `Location prompt`: The editable base instruction sent before generation.
- `Include connected locations`: Enables the connected locations block and its `Max locations` limit. Supports `{{connectedLocations}}`.
- `Connected locations block`: Editable prompt text for connected node choices.
- `Include aliases`: Enables the aliases block. Supports `{{aliases}}`.
- `Aliases block`: Editable prompt text for alias handling and lorebook format guidance.
- `Allow multi-hop location changes`: Enables the multi-hop block.
- `Multi-hop block`: Editable prompt text for movement through multiple connected spaces.
- `Max locations`: Limits how many connected-location choices are injected, keeping the prompt compact.
- `Prompt Preview`: Visible when `Debug` is enabled and shows the final injected text.

Disabled prompt options grey out their text block but keep the custom text saved.
When `Use prompt injector` is off, all prompt insert controls are disabled.

Default base prompt:

```text
End with exactly one {{locationLine}} using a Current/Connected location; never invent one.
If movement is unclear, use Current location.
```

Example final injected prompt:

```text
End with exactly one Location: Exact Location Node Name using a Current/Connected location; never invent one.
If movement is unclear, use Current location.

Current location: West Tower Entrance

Connected locations: West Tower Forest | West Tower Observation Deck
```

Editable block placeholders:

```text
{{connectedLocations}}
{{aliases}}
{{locationLine}}
```

Optional lorebook entry sections:

```text
Aliases:
- outside the west tower
- tower approach

Connected locations: West Tower Forest | West Tower Observation Deck
```

## Runtime

The selected `background` is applied only with SillyTavern's `/bg` command. If that command fails, the current background and saved location are preserved; there is no direct DOM fallback.

### Per-chat location storage

The last successful location is stored under a key composed from the selected lorebook and current chat ID. On chat load, resolution follows this order:

1. Restore the saved location for this chat and lorebook.
2. Detect a marker, `Location:` declaration, or exact location name in the latest chat message.
3. Use the configured start location.

Normal prompts contain only `Current location:` and a compact one-line `Connected locations: A | B` list. Use the same pipe-separated format in the lorebook. Aliases are neither parsed, matched, validated, nor injected while `Include aliases` is disabled. Multi-hop may add up to `Max locations` additional managed nodes.

### No duplicate lorebook injection

Managed location entries are automatically marked disabled in the SillyTavern lorebook. The extension can still read their names, `Connected locations:` data and aliases directly, but SillyTavern will not inject the same entry content again as regular World Info. The entry's original enabled/disabled state is stored in the mapping and restored when the location is removed from the manager.

After a successful change, the extension emits a `location-background:changed` browser event.

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

If the model reports a location that is not a unique managed lorebook location, the extension rejects it. The assistant message is corrected to the saved current location (or configured start location), the corrected swipe is saved, and the existing background remains unchanged.

## Debug

In the browser console:

```js
locationBackgroundManager.reload()
locationBackgroundManager.selectWorld("West Tower")
locationBackgroundManager.setMarkerDetection(true)
locationBackgroundManager.testText("Location: West Tower Entrance")
locationBackgroundManager.getPrompt()
locationBackgroundManager.refreshPrompt()
locationBackgroundManager.getState()
```
