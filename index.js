import { extension_settings, getContext } from '../../../extensions.js';

const MODULE_NAME = 'location-background';
const MODULE_LABEL = 'Location Background Manager';
const SETTINGS_URL = new URL('./settings.html', import.meta.url);
const LOCATION_CHANGED_EVENT = 'location-background:changed';
const IGNORED_LOCATION_MARKERS = new Set(['none', 'unknown', 'same', 'unchanged', 'no change', 'n/a', 'null']);
const PROMPT_INJECTION_DEPTH = 0;
const LOCATION_LINE_FORMATS = Object.freeze({
    visible: 'visible',
    hidden: 'hidden',
});
const LEGACY_LOCATION_PROMPT = [
    'Choose the current location from the location graph only.',
    'Never invent new location names.',
    'End every narrator reply with:',
    'Location: Exact Location Node Name',
    'If uncertain, keep the previous exact location.',
].join('\n');
const LEGACY_SELECTED_LOREBOOK_LOCATION_PROMPT = [
    'Choose the current location from the selected lorebook location entries only.',
    'Never invent new location names.',
    'End every narrator reply with:',
    'Location: Exact Location Node Name',
    'If uncertain, keep the previous exact location.',
].join('\n');
const LEGACY_LOCATION_PROMPT_WITH_ALIAS_RULE = [
    'Choose the current location from the selected lorebook location entries only.',
    'Never invent new location names.',
    'End every narrator reply with:',
    'Location: Exact Location Node Name',
    'Choose exactly one existing location name from the locations above.',
    'If the scene changed, output the new exact node name.',
    'If not, repeat the same current location.',
    'Use aliases to convert scene wording to the exact location node name.',
    'If uncertain, keep the previous exact location.',
].join('\n');
const LEGACY_LOCATION_PROMPT_WITH_CHOICE_RULES = [
    'Choose the current location from the selected lorebook location entries only.',
    'Never invent new location names.',
    'End every narrator reply with:',
    'Location: Exact Location Node Name',
    'Choose exactly one existing location name from the locations above.',
    'If the scene changed, output the new exact node name.',
    'If not, repeat the same current location.',
    'If uncertain, keep the previous exact location.',
].join('\n');
const PREVIOUS_LOCATION_PROMPT = [
    'Choose the current location from the selected lorebook location entries only.',
    'Never invent new location names.',
    'End every narrator reply with:',
    '{{locationLine}}',
    'Write exactly one location line and no more.',
    'Choose exactly one existing location name listed in this instruction.',
    'If the scene changed, output the new exact node name.',
    'If not, repeat the same current location.',
    'If uncertain, keep the previous exact location.',
].join('\n');
const DEFAULT_LOCATION_PROMPT = [
    'End every reply with exactly one {{locationLine}}.',
    'Use an exact listed location; never invent one.',
    'If movement is unclear, keep the current location.',
].join('\n');
const LEGACY_CONNECTED_LOCATIONS_BLOCK = [
    'Use connected locations as the preferred next choices from the current node.',
    'Connected locations:',
    '{{connectedLocations}}',
    '',
    'Lorebook entry format example:',
    'Connected locations:',
    '- West Tower Forest',
    '- West Tower Observation Deck',
].join('\n');
const DEFAULT_CONNECTED_LOCATIONS_BLOCK = [
    'Connected: {{connectedLocations}}',
].join('\n');
const PREVIOUS_CONNECTED_LOCATIONS_BLOCK = [
    'Use connected locations as the preferred next choices from the current node.',
    'Connected locations:',
    '{{connectedLocations}}',
].join('\n');
const INTERMEDIATE_CONNECTED_LOCATIONS_BLOCK = [
    'Connected locations:',
    '{{connectedLocations}}',
].join('\n');
const LEGACY_ALIASES_BLOCK = [
    'Use aliases to convert scene wording to the exact location node name.',
    'Aliases:',
    '{{aliases}}',
    '',
    'Lorebook entry format example:',
    'Aliases:',
    '- outside the west tower',
    '- tower approach',
].join('\n');
const LEGACY_MINIMAL_ALIASES_BLOCK = [
    'Aliases:',
    '{{aliases}}',
].join('\n');
const DEFAULT_ALIASES_BLOCK = [
    'Aliases:',
    '{{aliases}}',
].join('\n');
const PREVIOUS_ALIASES_BLOCK = [
    'Use aliases to convert scene wording to the exact location node name.',
    'Aliases:',
    '{{aliases}}',
].join('\n');
const DEFAULT_MULTI_HOP_BLOCK = [
    'For multi-hop movement, choose only the final reached listed location.',
].join('\n');
const PREVIOUS_MULTI_HOP_BLOCK = [
    'If the scene clearly moves through multiple spaces in one reply, choose the final physically reached location, but only if it is reachable through valid nearby nodes.',
    'If not sure, keep the current location.',
].join('\n');

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    showToasts: false,
    debug: false,
    markerDetection: true,
    promptInjector: true,
    locationPrompt: DEFAULT_LOCATION_PROMPT,
    includeConnectedLocations: true,
    connectedLocationsBlock: DEFAULT_CONNECTED_LOCATIONS_BLOCK,
    includeAliases: false,
    aliasesBlock: DEFAULT_ALIASES_BLOCK,
    allowMultiHop: false,
    multiHopBlock: DEFAULT_MULTI_HOP_BLOCK,
    locationLineFormat: LOCATION_LINE_FORMATS.visible,
    maxPromptLocations: 12,
    startLocations: {},
    chatLocations: {},
    selectedWorld: '',
    books: {},
});

let initialized = false;
let eventsRegistered = false;
let settingsRendered = false;
let activeWorldName = '';
let activeWorldData = null;
let availableWorldNames = [];
let lastAppliedDetail = null;
let lastStatusMessage = 'Starting...';
let lastStatusIsError = false;
let lastProcessedLocationSignature = '';

function getSillyTavernContext() {
    return getContext?.() ?? globalThis.SillyTavern?.getContext?.();
}

function getChatLocationKey() {
    const context = getSillyTavernContext();
    const chatId = context?.chatId
        ?? context?.chat_id
        ?? context?.getCurrentChatId?.()
        ?? context?.chatMetadata?.chat_id
        ?? context?.chat?.[0]?.send_date
        ?? context?.chat?.[0]?.mes
        ?? 'no-chat';
    return `${normalizeName(activeWorldName || getSettingsWithoutMigration()?.selectedWorld || 'no-world')}::${normalizeName(chatId)}`;
}

function getSettingsWithoutMigration() {
    const value = extension_settings[MODULE_NAME];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getSillyTavernHeaders() {
    return getSillyTavernContext()?.getRequestHeaders?.() ?? {
        'Content-Type': 'application/json',
    };
}

function getSettings() {
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object' || Array.isArray(extension_settings[MODULE_NAME])) {
        extension_settings[MODULE_NAME] = {};
    }

    const settings = extension_settings[MODULE_NAME];

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in settings)) {
            settings[key] = structuredClone(value);
        }
    }

    if (!settings.books || typeof settings.books !== 'object' || Array.isArray(settings.books)) {
        settings.books = {};
    }

    if (!settings.chatLocations || typeof settings.chatLocations !== 'object' || Array.isArray(settings.chatLocations)) {
        settings.chatLocations = {};
    }
    if (!settings.startLocations || typeof settings.startLocations !== 'object' || Array.isArray(settings.startLocations)) {
        settings.startLocations = {};
    }

    // Migrate the old global location once, then keep all future state chat-scoped.
    if (settings.currentLocation && !settings.chatLocations[getChatLocationKey()]) {
        settings.chatLocations[getChatLocationKey()] = normalizeName(settings.currentLocation);
    }
    delete settings.currentLocation;
    delete settings.currentLocationBlock;
    delete settings.promptTokenBudget;
    delete settings.useLorebookActivation;

    for (const book of Object.values(settings.books)) {
        for (const mapping of Object.values(book?.entries ?? {})) {
            delete mapping.music;
            delete mapping.weather;
        }
    }

    if ([LEGACY_LOCATION_PROMPT, LEGACY_SELECTED_LOREBOOK_LOCATION_PROMPT, LEGACY_LOCATION_PROMPT_WITH_ALIAS_RULE, LEGACY_LOCATION_PROMPT_WITH_CHOICE_RULES, PREVIOUS_LOCATION_PROMPT].includes(settings.locationPrompt)) {
        settings.locationPrompt = DEFAULT_LOCATION_PROMPT;
    }

    if ([LEGACY_CONNECTED_LOCATIONS_BLOCK, PREVIOUS_CONNECTED_LOCATIONS_BLOCK, INTERMEDIATE_CONNECTED_LOCATIONS_BLOCK].includes(settings.connectedLocationsBlock)) {
        settings.connectedLocationsBlock = DEFAULT_CONNECTED_LOCATIONS_BLOCK;
    }

    if ([LEGACY_ALIASES_BLOCK, LEGACY_MINIMAL_ALIASES_BLOCK, PREVIOUS_ALIASES_BLOCK].includes(settings.aliasesBlock)) {
        settings.aliasesBlock = DEFAULT_ALIASES_BLOCK;
    }
    if (settings.multiHopBlock === PREVIOUS_MULTI_HOP_BLOCK) {
        settings.multiHopBlock = DEFAULT_MULTI_HOP_BLOCK;
    }

    return settings;
}

function saveSettings() {
    getSillyTavernContext()?.saveSettingsDebounced?.();
}

function log(...args) {
    console.info(`[${MODULE_LABEL}]`, ...args);
}

function warn(message, ...args) {
    console.warn(`[${MODULE_LABEL}] ${message}`, ...args);
}

function showToast(kind, message) {
    const toastr = globalThis.toastr;
    if (!toastr) {
        return;
    }

    const method = toastr[kind];
    if (typeof method === 'function') {
        method.call(toastr, message, MODULE_LABEL);
    }
}

function normalizeName(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function getBookStore(worldName, createIfMissing = false) {
    const settings = getSettings();
    const normalizedWorldName = normalizeName(worldName);

    if (!normalizedWorldName) {
        return null;
    }

    if (!settings.books[normalizedWorldName] && createIfMissing) {
        settings.books[normalizedWorldName] = { entries: {} };
    }

    const book = settings.books[normalizedWorldName];
    if (!book || typeof book !== 'object' || Array.isArray(book)) {
        return null;
    }

    if (!book.entries || typeof book.entries !== 'object' || Array.isArray(book.entries)) {
        book.entries = {};
    }

    return book;
}

function getEntryLabel(entry) {
    const label = normalizeName(entry?.comment || entry?.title || entry?.name || entry?.memo || '');
    if (label) {
        return label;
    }

    const keys = Array.isArray(entry?.key) ? entry.key.filter(Boolean).map(normalizeName) : [];
    return keys.length ? keys.join(', ') : 'Untitled entry';
}

function getEntryKeysText(entry) {
    const keys = Array.isArray(entry?.key) ? entry.key.filter(Boolean).map(normalizeName) : [];
    return keys.length ? keys.join(', ') : '-';
}

function getSortedWorldEntries() {
    if (!activeWorldData?.entries) {
        return [];
    }

    return Object.values(activeWorldData.entries).sort((left, right) => {
        const leftIndex = Number(left.displayIndex ?? left.uid ?? 0);
        const rightIndex = Number(right.displayIndex ?? right.uid ?? 0);
        return leftIndex - rightIndex;
    });
}

function getEntryByUid(uid) {
    return activeWorldData?.entries?.[String(uid)] ?? null;
}

function getEntryMapping(book, uid) {
    return book?.entries?.[String(uid)] ?? null;
}

function getAvailableBackgroundNames() {
    const names = new Set();

    for (const element of document.querySelectorAll('.bg_example')) {
        const name = normalizeName(
            element.getAttribute('bgfile')
            || element.dataset?.bgfile
            || element.dataset?.name
            || element.getAttribute('title')
            || element.textContent,
        );

        if (name) {
            names.add(name);
        }
    }

    for (const mapping of Object.values(getCurrentWorldMappings())) {
        const background = normalizeName(mapping?.background);
        if (background) {
            names.add(background);
        }
    }

    return [...names].sort((left, right) => left.localeCompare(right));
}

function setEntryMapping(worldName, entry, value) {
    const book = getBookStore(worldName, true);
    if (!book || !entry) {
        return;
    }

    const uid = String(entry.uid);
    if (!book.entries[uid]) {
        book.entries[uid] = {
            label: getEntryLabel(entry),
            background: '',
            originalDisabled: !!entry.disable,
        };
    }

    book.entries[uid].label = getEntryLabel(entry);
    book.entries[uid].background = normalizeName(value);
    saveSettings();
    refreshSettingsUI();
}

function removeEntryMapping(worldName, uid) {
    const book = getBookStore(worldName, false);
    if (!book || !book.entries?.[String(uid)]) {
        return;
    }

    delete book.entries[String(uid)];
    if (String(getSettings().startLocations[normalizeName(worldName)] ?? '') === String(uid)) {
        delete getSettings().startLocations[normalizeName(worldName)];
    }

    saveSettings();
    refreshSettingsUI();
}

function setStatus(message, isError = false) {
    lastStatusMessage = message;
    lastStatusIsError = isError;
    const statusElement = $('#location_background_status');
    statusElement.text(message);
    statusElement.toggleClass('redWarning', isError);
}

function getSelectedWorldName() {
    const selectValue = normalizeName($('#location_background_world').val());
    if (selectValue) {
        return selectValue;
    }

    const settings = getSettings();
    return normalizeName(settings.selectedWorld);
}

async function fetchWorldNames() {
    const response = await fetch('/api/settings/get', {
        method: 'POST',
        headers: getSillyTavernHeaders(),
        body: JSON.stringify({}),
    });

    if (!response.ok) {
        throw new Error(`Could not load lorebook list: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data.world_names) ? data.world_names : [];
}

function renderWorldOptions() {
    const select = $('#location_background_world');
    if (!select.length) {
        return;
    }

    const settings = getSettings();
    const preferredWorld = normalizeName(settings.selectedWorld);
    const currentSelection = normalizeName(select.val());
    const selectedValue = preferredWorld || currentSelection || '';

    select.empty();

    const worlds = availableWorldNames;

    if (worlds.length === 0) {
        select.append($('<option>').val('').text('No lorebooks available'));
        select.prop('disabled', true);
        return;
    }

    select.prop('disabled', false);
    select.append($('<option>').val('').text('Select a lorebook'));

    for (const worldName of worlds) {
        select.append($('<option>').val(worldName).text(worldName));
    }

    if (selectedValue && worlds.includes(selectedValue)) {
        select.val(selectedValue);
    } else if (!selectedValue && worlds.length > 0) {
        const firstWorld = worlds[0];
        select.val(firstWorld);
        settings.selectedWorld = firstWorld;
        saveSettings();
    }
}

function renderEntryPicker() {
    const picker = $('#location_background_entry_picker');
    const addButton = $('#location_background_add_entry');
    if (!picker.length) {
        return;
    }

    const currentValue = normalizeName(picker.val());
    const entries = getSortedWorldEntries();
    const book = getBookStore(activeWorldName, false);
    const configuredUids = new Set(Object.keys(book?.entries ?? {}));
    const availableEntries = entries.filter((entry) => !configuredUids.has(String(entry.uid)));

    picker.empty();

    if (!activeWorldName) {
        picker.append($('<option>').val('').text('Select a lorebook first'));
        picker.prop('disabled', true);
        addButton.prop('disabled', true);
        return;
    }

    if (entries.length === 0) {
        picker.append($('<option>').val('').text('This lorebook has no entries'));
        picker.prop('disabled', true);
        addButton.prop('disabled', true);
        return;
    }

    if (availableEntries.length === 0) {
        picker.append($('<option>').val('').text('All entries are already added'));
        picker.prop('disabled', true);
        addButton.prop('disabled', true);
        return;
    }

    picker.prop('disabled', false);
    addButton.prop('disabled', false);
    picker.append($('<option>').val('').text('Select a lorebook entry'));

    for (const entry of availableEntries) {
        const uid = String(entry.uid);
        picker.append($('<option>')
            .val(uid)
            .text(getEntryLabel(entry)));
    }

    if (currentValue && availableEntries.some((entry) => String(entry.uid) === currentValue)) {
        picker.val(currentValue);
    }
}

function renderLocationsList() {
    const body = $('#location_background_locations_body');
    if (!body.length) {
        return;
    }

    body.empty();

    if (!activeWorldName) {
        body.append($('<tr>').append($('<td colspan="3">').text('Select a lorebook first')));
        return;
    }

    const book = getBookStore(activeWorldName, false);
    const mappings = book?.entries ?? {};
    const entries = Object.entries(mappings).sort(([, left], [, right]) => {
        return normalizeName(left?.label).localeCompare(normalizeName(right?.label));
    });

    if (entries.length === 0) {
        body.append($('<tr>').append($('<td colspan="3">').text('No location entries added yet')));
        return;
    }

    for (const [uid, mapping] of entries) {
        const entry = getEntryByUid(uid);
        const label = entry ? getEntryLabel(entry) : normalizeName(mapping?.label) || 'Unknown entry';
        const row = $('<tr>').attr('data-uid', uid);

        const labelCell = $('<td>');
        labelCell.append($('<div>').addClass('location-background-entry-title').text(label));

        const backgroundCell = $('<td>');
        const currentBackground = normalizeName(mapping?.background);
        const backgroundSelect = $('<select>')
            .addClass('text_pole wide100p location-background-background-select');
        const backgroundNames = getAvailableBackgroundNames();

        backgroundSelect.append($('<option>').val('').text('Select background'));
        for (const background of backgroundNames) {
            backgroundSelect.append($('<option>').val(background).text(background));
        }
        backgroundSelect.val(currentBackground);
        backgroundCell.append(backgroundSelect);

        const actionsCell = $('<td>').addClass('location-background-actions');
        actionsCell.append($('<button>')
            .addClass('menu_button menu_button_small location-background-remove-entry')
            .attr('type', 'button')
            .attr('title', 'Remove location entry')
            .append($('<i>').addClass('fa-solid fa-trash')));

        row.append(labelCell, backgroundCell, actionsCell);
        body.append(row);
    }
}

function renderStartLocationOptions() {
    const select = $('#location_background_start_location');
    if (!select.length) return;
    const selectedUid = String(getSettings().startLocations[activeWorldName] ?? '');
    select.empty().append($('<option>').val('').text('No start location'));
    for (const [uid, mapping] of Object.entries(getCurrentWorldMappings())
        .filter(([, value]) => normalizeName(value?.background))
        .sort(([, left], [, right]) => normalizeName(left?.label).localeCompare(normalizeName(right?.label)))) {
        const entry = getEntryByUid(uid);
        select.append($('<option>').val(uid).text(entry ? getEntryLabel(entry) : mapping.label));
    }
    select.val(selectedUid);
}

function refreshSettingsUI() {
    const settings = getSettings();
    const selectedWorld = getSelectedWorldName();
    const programEnabled = !!settings.enabled;
    const promptEnabled = programEnabled && !!settings.promptInjector;

    $('#location_background_enabled').prop('checked', !!settings.enabled);
    $('#location_background_show_toasts').prop('checked', !!settings.showToasts);
    $('#location_background_debug').prop('checked', !!settings.debug);
    $('#location_background_debug_info').toggle(!!settings.debug);
    $('#location_background_top_controls').toggleClass('location-background-disabled', !programEnabled);
    $('#location_background_top_controls').find('input, select, textarea, button').prop('disabled', !programEnabled);
    $('#location_background_main_controls').toggleClass('location-background-disabled', !programEnabled);
    $('#location_background_main_controls').find('input, select, textarea, button').prop('disabled', !programEnabled);
    $('#location_background_prompt_injector').prop('checked', !!settings.promptInjector);
    $('#location_background_prompt_text').val(String(settings.locationPrompt ?? DEFAULT_LOCATION_PROMPT));
    $('#location_background_line_format').val(Object.values(LOCATION_LINE_FORMATS).includes(settings.locationLineFormat)
        ? settings.locationLineFormat
        : LOCATION_LINE_FORMATS.visible);
    $('#location_background_include_connected').prop('checked', !!settings.includeConnectedLocations);
    $('#location_background_connected_block').val(String(settings.connectedLocationsBlock ?? DEFAULT_CONNECTED_LOCATIONS_BLOCK));
    $('#location_background_include_aliases').prop('checked', !!settings.includeAliases);
    $('#location_background_aliases_block').val(String(settings.aliasesBlock ?? DEFAULT_ALIASES_BLOCK));
    $('#location_background_allow_multihop').prop('checked', !!settings.allowMultiHop);
    $('#location_background_multihop_block').val(String(settings.multiHopBlock ?? DEFAULT_MULTI_HOP_BLOCK));
    $('#location_background_prompt_controls').toggleClass('location-background-disabled', !promptEnabled);
    $('#location_background_prompt_text').prop('disabled', !promptEnabled);
    $('#location_background_line_format').prop('disabled', !promptEnabled);
    $('#location_background_include_connected').prop('disabled', !promptEnabled);
    $('#location_background_include_aliases').prop('disabled', !promptEnabled);
    $('#location_background_allow_multihop').prop('disabled', !promptEnabled);
    $('#location_background_connected_block').prop('disabled', !promptEnabled || !settings.includeConnectedLocations);
    $('#location_background_aliases_block').prop('disabled', !promptEnabled || !settings.includeAliases);
    $('#location_background_multihop_block').prop('disabled', !promptEnabled || !settings.allowMultiHop);
    $('#location_background_max_locations').prop('disabled', !promptEnabled || !settings.includeConnectedLocations);
    $('#location_background_max_locations').val(String(clampNumber(settings.maxPromptLocations, 1, 50, DEFAULT_SETTINGS.maxPromptLocations)));
    $('#location_background_world').val(selectedWorld);
    $('#location_background_world_count').text(String(availableWorldNames.length));
    $('#location_background_selected_world').text(selectedWorld || 'None');
    $('#location_background_entry_count').text(String(Object.keys(activeWorldData?.entries || {}).length));
    $('#location_background_status').text(lastStatusMessage);
    $('#location_background_status').toggleClass('redWarning', lastStatusIsError);
    $('#location_background_last').text(lastAppliedDetail
        ? `${lastAppliedDetail.entryLabel} -> ${lastAppliedDetail.background || 'no background'}`
        : 'None yet');

    renderEntryPicker();
    renderLocationsList();
    renderStartLocationOptions();
    refreshPromptInjection();
}

async function renderSettingsPanel() {
    if (settingsRendered || document.getElementById('location_background_settings')) {
        settingsRendered = true;
        refreshSettingsUI();
        return;
    }

    const container = $('#extensions_settings');
    if (!container.length) {
        warn('Could not find #extensions_settings.');
        return;
    }

    const response = await fetch(SETTINGS_URL, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Could not load ${SETTINGS_URL.pathname}: ${response.status} ${response.statusText}`);
    }

    container.append(await response.text());
    settingsRendered = true;
    bindSettingsEvents();
    refreshSettingsUI();
}

async function fetchWorldBook(worldName) {
    if (!worldName) {
        return null;
    }

    const response = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getSillyTavernHeaders(),
        body: JSON.stringify({ name: worldName }),
        cache: 'no-cache',
    });

    if (!response.ok) {
        throw new Error(`Could not load lorebook "${worldName}": ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

async function saveActiveWorldBook() {
    if (!activeWorldName || !activeWorldData) return false;
    const response = await fetch('/api/worldinfo/edit', {
        method: 'POST',
        headers: getSillyTavernHeaders(),
        body: JSON.stringify({ name: activeWorldName, data: activeWorldData }),
    });
    if (!response.ok) {
        throw new Error(`Could not update lorebook "${activeWorldName}": ${response.status} ${response.statusText}`);
    }
    return true;
}

async function setManagedEntryPromptExclusion(uid, excluded) {
    const entry = getEntryByUid(uid);
    const mapping = getEntryMapping(getBookStore(activeWorldName, false), uid);
    if (!entry || !mapping) return false;
    const targetDisabled = excluded ? true : !!mapping.originalDisabled;
    if (!!entry.disable === targetDisabled) return true;
    entry.disable = targetDisabled;
    await saveActiveWorldBook();
    return true;
}

async function ensureManagedEntriesExcluded() {
    const book = getBookStore(activeWorldName, false);
    if (!book) return;
    let changed = false;
    for (const [uid, mapping] of Object.entries(book.entries)) {
        const entry = getEntryByUid(uid);
        if (!entry) continue;
        if (!Object.hasOwn(mapping, 'originalDisabled')) {
            mapping.originalDisabled = !!entry.disable;
            changed = true;
        }
        if (!entry.disable) {
            entry.disable = true;
            changed = true;
        }
    }
    if (changed) {
        saveSettings();
        await saveActiveWorldBook();
    }
}

async function loadSelectedWorld(worldName = getSelectedWorldName()) {
    const normalizedWorld = normalizeName(worldName);
    const settings = getSettings();

    if (!normalizedWorld) {
        activeWorldName = '';
        activeWorldData = null;
        refreshSettingsUI();
        return;
    }

    activeWorldName = normalizedWorld;
    settings.selectedWorld = normalizedWorld;
    saveSettings();

    setStatus(`Loading lorebook "${normalizedWorld}"...`);
    refreshSettingsUI();

    try {
        activeWorldData = await fetchWorldBook(normalizedWorld);
        await ensureManagedEntriesExcluded();
        const warnings = validateLocationConfiguration();
        setStatus(warnings.length
            ? `Loaded lorebook with ${warnings.length} configuration warning(s). See the browser console.`
            : `Loaded lorebook "${normalizedWorld}" with ${Object.keys(activeWorldData?.entries || {}).length} entries.`, warnings.length > 0);
        if (warnings.length) {
            warn('Location configuration warnings:', warnings);
        }
        refreshSettingsUI();
        await initializeCurrentChatLocation();
    } catch (error) {
        activeWorldData = null;
        setStatus(error.message, true);
        showToast('warning', error.message);
        refreshSettingsUI();
    }
}

async function onAddLocationClick() {
    const uid = normalizeName($('#location_background_entry_picker').val());
    const entry = getEntryByUid(uid);

    if (!entry) {
        setStatus('Select a lorebook entry first.', true);
        return;
    }

    setEntryMapping(activeWorldName, entry, '');
    try {
        await setManagedEntryPromptExclusion(uid, true);
    } catch (error) {
        removeEntryMapping(activeWorldName, uid);
        setStatus(error.message, true);
        showToast('warning', error.message);
        return;
    }
    setStatus(`Added location "${getEntryLabel(entry)}".`);
}

function onBackgroundSelectChange(event) {
    const select = event.currentTarget;
    const row = select.closest('tr');
    const uid = row?.getAttribute('data-uid');
    const entry = getEntryByUid(uid) ?? { uid };

    if (!uid) {
        return;
    }

    setEntryMapping(activeWorldName, entry, select.value);
    setStatus(`Saved background for "${getEntryLabel(entry)}".`);
}

async function onRemoveEntryClick(event) {
    const button = event.currentTarget;
    const row = button.closest('tr');
    const uid = row?.getAttribute('data-uid');

    if (!uid) {
        return;
    }

    const entry = getEntryByUid(uid);
    const label = entry ? getEntryLabel(entry) : getBookStore(activeWorldName, false)?.entries?.[uid]?.label || 'location entry';
    try {
        await setManagedEntryPromptExclusion(uid, false);
    } catch (error) {
        setStatus(error.message, true);
        showToast('warning', error.message);
        return;
    }
    removeEntryMapping(activeWorldName, uid);
    setStatus(`Removed "${label}" from the manager.`);
}

function bindSettingsEvents() {
    $('#location_background_enabled').on('change', function () {
        getSettings().enabled = !!$(this).prop('checked');
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_show_toasts').on('change', function () {
        getSettings().showToasts = !!$(this).prop('checked');
        saveSettings();
    });

    $('#location_background_debug').on('change', function () {
        getSettings().debug = !!$(this).prop('checked');
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_prompt_injector').on('change', function () {
        getSettings().promptInjector = !!$(this).prop('checked');
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_prompt_text').on('input change', function () {
        getSettings().locationPrompt = String($(this).val() ?? '');
        saveSettings();
        refreshPromptInjection();
    });

    $('#location_background_line_format').on('change', function () {
        const value = String($(this).val() ?? LOCATION_LINE_FORMATS.visible);
        getSettings().locationLineFormat = Object.values(LOCATION_LINE_FORMATS).includes(value)
            ? value
            : LOCATION_LINE_FORMATS.visible;
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_connected_block').on('input change', function () {
        getSettings().connectedLocationsBlock = String($(this).val() ?? '');
        saveSettings();
        refreshPromptInjection();
    });

    $('#location_background_aliases_block').on('input change', function () {
        getSettings().aliasesBlock = String($(this).val() ?? '');
        saveSettings();
        refreshPromptInjection();
    });

    $('#location_background_multihop_block').on('input change', function () {
        getSettings().multiHopBlock = String($(this).val() ?? '');
        saveSettings();
        refreshPromptInjection();
    });

    $('#location_background_include_connected').on('change', function () {
        getSettings().includeConnectedLocations = !!$(this).prop('checked');
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_include_aliases').on('change', function () {
        getSettings().includeAliases = !!$(this).prop('checked');
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_allow_multihop').on('change', function () {
        getSettings().allowMultiHop = !!$(this).prop('checked');
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_max_locations').on('change', function () {
        getSettings().maxPromptLocations = clampNumber($(this).val(), 1, 50, DEFAULT_SETTINGS.maxPromptLocations);
        saveSettings();
        refreshSettingsUI();
    });

    $('#location_background_start_location').on('change', function () {
        const uid = normalizeName($(this).val());
        if (uid) getSettings().startLocations[activeWorldName] = uid;
        else delete getSettings().startLocations[activeWorldName];
        saveSettings();
        refreshPromptInjection();
    });

    $('#location_background_world').on('change', async function () {
        const worldName = normalizeName($(this).val());
        await loadSelectedWorld(worldName);
    });

    $('#location_background_refresh_worlds').on('click', async () => {
        await refreshWorldNames();
    });

    $('#location_background_reload_world').on('click', async () => {
        await loadSelectedWorld();
    });

    $('#location_background_add_entry').on('click', onAddLocationClick);
    $('#location_background_locations_body').on('change', '.location-background-background-select', onBackgroundSelectChange);
    $('#location_background_locations_body').on('click', '.location-background-remove-entry', onRemoveEntryClick);
}

async function refreshWorldNames() {
    availableWorldNames = await fetchWorldNames();
    renderWorldOptions();
    await loadSelectedWorld();
}

function readEntryNames(entry) {
    const names = [
        entry?.comment,
        entry?.title,
        entry?.name,
        entry?.memo,
        ...(Array.isArray(entry?.key) ? entry.key : []),
        ...(Array.isArray(entry?.keys) ? entry.keys : []),
    ];

    return [...new Set(names.map(normalizeName).filter(Boolean))];
}

function getCurrentWorldMappings() {
    const settings = getSettings();
    return settings.books[activeWorldName]?.entries ?? {};
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(number)));
}

function splitLocationList(value) {
    return String(value ?? '')
        .split(/[,;|]/)
        .map((item) => normalizeName(item.replace(/^[-*]\s*/, '')))
        .filter(Boolean);
}

function getEntryContentText(entry) {
    return [
        entry?.content,
        entry?.text,
        entry?.description,
    ].filter((value) => typeof value === 'string' && value.trim()).join('\n');
}

function extractEntrySectionList(entry, sectionNames) {
    const text = getEntryContentText(entry);
    if (!text) {
        return [];
    }

    const normalizedSections = sectionNames.map((name) => name.toLowerCase());
    const values = [];
    let collecting = false;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = normalizeName(rawLine);
        if (!line) {
            collecting = false;
            continue;
        }

        const headingMatch = line.match(/^([a-z ]+)\s*:\s*(.*)$/i);
        if (headingMatch) {
            const heading = normalizeName(headingMatch[1]).toLowerCase();
            collecting = normalizedSections.includes(heading);
            if (collecting && headingMatch[2]) {
                values.push(...splitLocationList(headingMatch[2]));
            }
            continue;
        }

        if (collecting) {
            if (/^[a-z ]+\s*:/i.test(line)) {
                collecting = false;
                continue;
            }
            values.push(...splitLocationList(line));
        }
    }

    return [...new Set(values)];
}

function getPromptLocationEntries() {
    const mappings = getCurrentWorldMappings();
    const useAliases = !!getSettings().includeAliases;

    return Object.entries(mappings)
        .filter(([, mapping]) => normalizeName(mapping?.background))
        .map(([uid, mapping]) => {
            const entry = getEntryByUid(uid);
            const label = entry ? getEntryLabel(entry) : normalizeName(mapping?.label) || 'Unknown entry';
            const aliases = useAliases ? [
                ...readEntryNames(entry ?? {}),
                ...extractEntrySectionList(entry, ['alias', 'aliases', 'also known as']),
            ].filter((name) => name && !hasSharedLocationKey(name, label)) : [];
            const connections = extractEntrySectionList(entry, ['connected locations']);

            return {
                uid,
                entry,
                mapping,
                label,
                aliases: [...new Set(aliases)],
                connections,
            };
        })
        .sort((left, right) => left.label.localeCompare(right.label));
}

function validateLocationConfiguration() {
    const locations = getPromptLocationEntries();
    const warnings = [];
    const knownBackgrounds = new Set(Array.from(document.querySelectorAll('.bg_example'))
        .map((node) => normalizeName(node.getAttribute('bgfile') || node.dataset?.bgfile))
        .filter(Boolean));

    for (const location of locations) {
        if (knownBackgrounds.size && !knownBackgrounds.has(normalizeName(location.mapping.background))) {
            warnings.push(`${location.label}: background "${location.mapping.background}" is not available`);
        }
        for (const connection of location.connections) {
            const matches = locations.filter((candidate) => [candidate.label, ...candidate.aliases]
                .some((name) => hasSharedLocationKey(name, connection)));
            if (matches.length === 0) {
                warnings.push(`${location.label}: connection "${connection}" does not match a managed location`);
            } else if (matches.length > 1) {
                warnings.push(`${location.label}: connection "${connection}" is ambiguous`);
            }
        }
    }

    for (let index = 0; index < locations.length; index++) {
        for (let otherIndex = index + 1; otherIndex < locations.length; otherIndex++) {
            const left = locations[index];
            const right = locations[otherIndex];
            if ([left.label, ...left.aliases].some((leftName) => [right.label, ...right.aliases]
                .some((rightName) => hasSharedLocationKey(leftName, rightName)))) {
                warnings.push(`${left.label} and ${right.label}: duplicate or ambiguous names/aliases`);
            }
        }
    }

    return [...new Set(warnings)];
}

function findPromptLocationByName(locationName, locations = getPromptLocationEntries()) {
    return locations.find((location) => {
        const names = [location.label, ...location.aliases];
        return names.some((name) => hasSharedLocationKey(name, locationName));
    }) ?? null;
}

function getCurrentLocationName() {
    const settings = getSettings();
    return normalizeName(settings.chatLocations[getChatLocationKey()] || '');
}

function setCurrentLocationName(locationName) {
    const settings = getSettings();
    const key = getChatLocationKey();
    const normalized = normalizeName(locationName);
    if (normalized) {
        settings.chatLocations[key] = normalized;
    } else {
        delete settings.chatLocations[key];
    }
    saveSettings();
}

function getConnectedPromptLocations(currentLocation, locations) {
    if (!currentLocation) {
        return [];
    }

    return currentLocation.connections
        .map((connection) => findPromptLocationByName(connection, locations))
        .filter(Boolean)
        .filter((location, index, list) => list.findIndex((item) => item.uid === location.uid) === index);
}

function renderPromptLocationList(locations) {
    return locations.map((location) => location.label).join(' | ');
}

function renderPromptAliasList(locations) {
    return locations
        .filter((location) => location.aliases.length)
        .map((location) => `- ${location.label}: ${location.aliases.join(', ')}`)
        .join('\n');
}

function getLocationLineInstruction() {
    return getSettings().locationLineFormat === LOCATION_LINE_FORMATS.hidden
        ? '<!-- Location: Exact Location Node Name -->'
        : 'Location: Exact Location Node Name';
}

function applyPromptTemplate(template, values) {
    return String(template ?? '')
        .replace(/\{\{currentLocation\}\}/g, values.currentLocation || 'Unknown')
        .replace(/\{\{connectedLocations\}\}/g, values.connectedLocations || '- None configured')
        .replace(/\{\{aliases\}\}/g, values.aliases || '- None configured')
        .replace(/\{\{locationLine\}\}/g, values.locationLine || getLocationLineInstruction())
        .trim();
}

function buildLocationPrompt() {
    const settings = getSettings();
    const basePrompt = applyPromptTemplate(settings.locationPrompt ?? DEFAULT_LOCATION_PROMPT, {
        locationLine: getLocationLineInstruction(),
    });
    if (!basePrompt) {
        return '';
    }

    const locations = getPromptLocationEntries();
    const maxLocations = clampNumber(settings.maxPromptLocations, 1, 50, DEFAULT_SETTINGS.maxPromptLocations);
    const currentLocation = findPromptLocationByName(getCurrentLocationName(), locations);
    const promptLines = [basePrompt];
    let candidateLocations = [];

    if (currentLocation) {
        promptLines.push('', `Current location: ${currentLocation.label}`);
    }

    if (settings.includeConnectedLocations && currentLocation) {
        candidateLocations = getConnectedPromptLocations(currentLocation, locations).slice(0, maxLocations);
        if (candidateLocations.length) {
            promptLines.push('', applyPromptTemplate(settings.connectedLocationsBlock ?? DEFAULT_CONNECTED_LOCATIONS_BLOCK, {
                connectedLocations: renderPromptLocationList(candidateLocations),
            }));
        }
    }


    if (settings.allowMultiHop) {
        const existingUids = new Set([currentLocation, ...candidateLocations].filter(Boolean).map((item) => item.uid));
        const extraLocations = locations.filter((location) => !existingUids.has(location.uid)).slice(0, maxLocations);
        if (extraLocations.length) {
            candidateLocations.push(...extraLocations);
            promptLines.push('', 'Reachable location graph:', renderPromptLocationList(extraLocations));
        }
    }

    if (settings.includeAliases) {
        const aliasLocations = [currentLocation, ...candidateLocations].filter(Boolean);
        const aliases = renderPromptAliasList(aliasLocations);
        if (aliases) {
            promptLines.push('', applyPromptTemplate(settings.aliasesBlock ?? DEFAULT_ALIASES_BLOCK, {
                aliases,
            }));
        }
    }

    if (settings.allowMultiHop) {
        promptLines.push('', String(settings.multiHopBlock ?? DEFAULT_MULTI_HOP_BLOCK).trim());
    }

    return promptLines.join('\n');
}

function getExtensionPromptTools() {
    const context = getSillyTavernContext();
    return {
        context,
        setExtensionPrompt: context?.setExtensionPrompt ?? globalThis.setExtensionPrompt,
        promptTypes: context?.extension_prompt_types ?? globalThis.extension_prompt_types ?? {},
        promptRoles: context?.extension_prompt_roles ?? globalThis.extension_prompt_roles ?? {},
    };
}

function setLocationExtensionPrompt(prompt) {
    const settings = getSettings();
    const tools = getExtensionPromptTools();

    if (typeof tools.setExtensionPrompt !== 'function') {
        if (settings.debug) {
            warn('setExtensionPrompt is not available in this SillyTavern context.');
        }
        return false;
    }

    const promptType = tools.promptTypes.IN_PROMPT ?? 0;
    const promptRole = tools.promptRoles.SYSTEM ?? 0;

    try {
        tools.setExtensionPrompt.call(tools.context ?? globalThis, MODULE_NAME, prompt, promptType, PROMPT_INJECTION_DEPTH, false, promptRole);
        return true;
    } catch (error) {
        warn(`Could not set extension prompt: ${error.message}`, error);
        return false;
    }
}

function refreshPromptInjection() {
    const settings = getSettings();
    const prompt = buildLocationPrompt();

    $('#location_background_prompt_preview').val(prompt);
    $('#location_background_prompt_preview_block').toggle(!!settings.debug);

    if (!settings.enabled || !settings.promptInjector || !prompt) {
        setLocationExtensionPrompt('');
        return;
    }

    setLocationExtensionPrompt(prompt);
}

function extractLocationMarker(text) {
    const matches = [...String(text ?? '').matchAll(/\[LBM_LOCATION\s*:\s*([^\]\r\n]+)\]/gi)];
    if (matches.length === 0) {
        return '';
    }

    return normalizeName(matches.at(-1)?.[1]?.replace(/^["'`]+|["'`]+$/g, ''));
}

function cleanLocationLine(value) {
    return normalizeName(String(value ?? '')
        .replace(/<!--|-->/g, '')
        .replace(/^["'`]+|["'`.,;:!?]+$/g, ''));
}

function getLocationMatchKeys(value) {
    const normalized = normalizeName(value).toLowerCase();
    const wordsOnly = normalizeName(normalized
        .replace(/<!--|-->/g, ' ')
        .replace(/[()[\]{}"'`]/g, ' ')
        .replace(/[-_:\/\\]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' '));
    const compact = wordsOnly.replace(/\s+/g, '');

    return new Set([normalized, wordsOnly, compact].filter(Boolean));
}

function hasSharedLocationKey(left, right) {
    const leftKeys = getLocationMatchKeys(left);
    const rightKeys = getLocationMatchKeys(right);

    for (const key of leftKeys) {
        if (rightKeys.has(key)) {
            return true;
        }
    }

    return false;
}

function extractLocationLine(text) {
    const lines = String(text ?? '')
        .split(/\r?\n/)
        .map(cleanLocationLine)
        .filter(Boolean);

    for (const line of lines.slice(-6).reverse()) {
        if (line.length > 100 || isIgnoredLocationMarker(line)) {
            continue;
        }

        if (findMappingByLocationName(line)) {
            return line;
        }
    }

    return '';
}

function extractLocationDeclaration(text) {
    const lines = String(text ?? '')
        .split(/\r?\n/)
        .map(cleanLocationLine)
        .filter(Boolean);

    for (const line of lines.slice(-8).reverse()) {
        const match = line.match(/^(?:current\s+)?location\s*[:=-]\s*(.+)$/i);
        const locationName = cleanLocationLine(match?.[1] || '');
        if (!isIgnoredLocationMarker(locationName)) {
            return locationName;
        }
    }

    return '';
}

function isIgnoredLocationMarker(locationName) {
    return !locationName || IGNORED_LOCATION_MARKERS.has(normalizeName(locationName).toLowerCase());
}

function getMappingLocationNames(uid, mapping) {
    const entry = getEntryByUid(uid);
    const names = [
        mapping?.label,
        entry ? getEntryLabel(entry) : '',
    ];
    if (getSettings().includeAliases && entry) {
        names.push(...readEntryNames(entry), ...extractEntrySectionList(entry, ['alias', 'aliases', 'also known as']));
    }

    return [...new Set(names.map(normalizeName).filter(Boolean))];
}

function findMappingByLocationName(locationName) {
    const target = normalizeName(locationName);
    if (!target) {
        return null;
    }

    const matches = [];
    for (const [uid, mapping] of Object.entries(getCurrentWorldMappings())) {
        const names = getMappingLocationNames(uid, mapping);
        if (!names.some((name) => hasSharedLocationKey(name, target))) {
            continue;
        }

        matches.push({
            uid,
            entry: getEntryByUid(uid) ?? { uid, comment: mapping?.label || locationName },
            mapping,
        });
    }

    if (matches.length === 1) {
        return matches[0];
    }

    if (matches.length > 1 && getSettings().debug) {
        setStatus(`Location "${locationName}" is ambiguous (${matches.length} configured entries match).`, true);
    }
    return null;
}

function extractMessageTextFromEventArgs(args) {
    const context = getSillyTavernContext();

    for (const value of args) {
        if (typeof value === 'number') {
            const message = context?.chat?.[value];
            if (message?.mes) {
                return message.mes;
            }
        }

        if (typeof value === 'string') {
            return value;
        }

        if (value && typeof value === 'object') {
            const candidates = [
                value.mes,
                value.text,
                value.content,
                value.message?.mes,
                value.message?.text,
                value.message?.content,
            ];
            const match = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
            if (match) {
                return match;
            }
        }
    }

    return context?.chat?.at?.(-1)?.mes || '';
}

function extractMessageSignatureFromEventArgs(args) {
    for (const value of args) {
        if (value && typeof value === 'object') {
            const signature = value.id ?? value.uid ?? value.message_id ?? value.messageId ?? value.mesId ?? value.mes_id;
            if (signature !== undefined && signature !== null && String(signature).trim()) {
                return String(signature);
            }
        }
    }

    const text = extractMessageTextFromEventArgs(args);
    return normalizeName(text);
}

async function processLocationMarkerText(text) {
    const settings = getSettings();
    if (!settings.enabled || !settings.markerDetection || !activeWorldName) {
        return false;
    }

    const locationName = extractLocationMarker(text) || extractLocationDeclaration(text) || extractLocationLine(text);
    if (isIgnoredLocationMarker(locationName)) {
        return false;
    }

    const match = findMappingByLocationName(locationName);
    if (!match?.mapping) {
        if (settings.debug) {
            setStatus(`Marker "${locationName}" is not configured as a location.`, true);
        }
        return false;
    }

    if (!match.mapping.background) {
        if (settings.debug) {
            setStatus(`Marker "${locationName}" has no background selected.`, true);
        }
        return false;
    }

    return await applyEntryMapping(match.entry, match.mapping);
}

async function onChatMessageForLocationMarker(...args) {
    try {
        const signature = extractMessageSignatureFromEventArgs(args);
        if (!signature || signature === lastProcessedLocationSignature) {
            return false;
        }

        const processed = await processLocationMarkerText(extractMessageTextFromEventArgs(args));
        if (processed) {
            lastProcessedLocationSignature = signature;
        }
        return processed;
    } catch (error) {
        warn(`Could not process location marker: ${error.message}`, error);
        return false;
    }
}

async function processLatestChatMessageMarker() {
    return await onChatMessageForLocationMarker();
}

async function restoreCurrentChatLocation() {
    const locationName = getCurrentLocationName();
    if (!locationName) {
        return false;
    }

    const match = findMappingByLocationName(locationName);
    if (!match?.mapping?.background) {
        setCurrentLocationName('');
        return false;
    }

    return await applyEntryMapping(match.entry, match.mapping);
}

async function applyConfiguredStartLocation() {
    const uid = String(getSettings().startLocations[activeWorldName] ?? '');
    if (!uid) return false;
    const mapping = getCurrentWorldMappings()[uid];
    const entry = getEntryByUid(uid);
    if (!mapping?.background || !entry) return false;
    return await applyEntryMapping(entry, mapping);
}

async function initializeCurrentChatLocation() {
    if (await restoreCurrentChatLocation()) return true;
    if (await processLatestChatMessageMarker()) return true;
    return await applyConfiguredStartLocation();
}

function applyBackground(background) {
    const context = getSillyTavernContext();
    const command = `/bg ${JSON.stringify(String(background))}`;

    if (typeof context?.executeSlashCommandsWithOptions === 'function') {
        return context.executeSlashCommandsWithOptions(command, {
            handleParserErrors: false,
            handleExecutionErrors: true,
            source: MODULE_NAME,
        }).then((result) => {
            if (result?.isError) {
                throw new Error(result.errorMessage || `Slash command failed: ${command}`);
            }
            return true;
        });
    }

    const bgCommand = context?.SlashCommandParser?.commands?.bg;
    if (bgCommand?.callback) {
        return Promise.resolve(bgCommand.callback({}, background)).then(() => true);
    }

    return Promise.resolve(false);
}

function emitLocationChanged(detail) {
    window.dispatchEvent(new CustomEvent(LOCATION_CHANGED_EVENT, { detail }));
}

async function applyEntryMapping(entry, mapping) {
    let applied = true;
    if (mapping.background) {
        try {
            applied = await applyBackground(mapping.background);
        } catch (error) {
            warn(`Slash command /bg failed for "${mapping.background}". Keeping the current background.`, error);
            applied = false;
        }
    }

    if (!applied) {
        setStatus(`Could not apply background "${mapping.background}".`, true);
        return false;
    }

    const detail = {
        world: activeWorldName,
        entryUid: String(entry.uid),
        entryLabel: getEntryLabel(entry),
        background: mapping.background || null,
    };

    lastAppliedDetail = detail;
    setCurrentLocationName(detail.entryLabel);
    emitLocationChanged(detail);
    setStatus(`Applied "${detail.entryLabel}" from "${activeWorldName}".`);
    $('#location_background_last').text(`${detail.entryLabel} -> ${detail.background || 'no background'}`);
    refreshPromptInjection();

    if (getSettings().showToasts) {
        showToast('info', `${detail.entryLabel} applied`);
    }

    log('Applied mapping', detail);
    return true;
}

function registerDebugApi() {
    globalThis.locationBackgroundManager = {
        reload: async () => {
            await refreshWorldNames();
        },
        selectWorld: async (worldName) => {
            $('#location_background_world').val(worldName).trigger('change');
        },
        setMapping: (worldName, uid, value) => {
            const book = getBookStore(worldName, true);
            if (!book.entries[String(uid)]) {
                book.entries[String(uid)] = { label: 'Untitled entry', background: '' };
            }
            book.entries[String(uid)].background = normalizeName(value);
            saveSettings();
            refreshSettingsUI();
        },
        removeMapping: (worldName, uid) => removeEntryMapping(worldName, uid),
        setMarkerDetection: (enabled) => {
            getSettings().markerDetection = !!enabled;
            saveSettings();
            refreshSettingsUI();
        },
        testText: async (text) => processLocationMarkerText(text),
        getPrompt: () => buildLocationPrompt(),
        refreshPrompt: () => refreshPromptInjection(),
        getState: () => structuredClone(getSettings()),
        eventName: LOCATION_CHANGED_EVENT,
    };
}

async function initialize() {
    if (initialized) {
        refreshSettingsUI();
        return;
    }

    initialized = true;
    getSettings();
    registerDebugApi();

    try {
        await renderSettingsPanel();
    } catch (error) {
        warn(`Could not render settings panel: ${error.message}`);
    }

    const context = getSillyTavernContext();
    const eventSource = context?.eventSource;
    const eventTypes = context?.eventTypes ?? context?.event_types;

    if (eventSource && !eventsRegistered) {
        eventsRegistered = true;
        for (const eventName of ['MESSAGE_RECEIVED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED']) {
            if (eventTypes?.[eventName]) {
                eventSource.on(eventTypes[eventName], onChatMessageForLocationMarker);
            }
        }
        if (eventTypes?.GENERATION_ENDED) {
            eventSource.on(eventTypes.GENERATION_ENDED, processLatestChatMessageMarker);
        }
        for (const eventName of ['GENERATION_STARTED', 'GENERATE_BEFORE_COMBINE_PROMPTS', 'CHAT_COMPLETION_PROMPT_READY']) {
            if (eventTypes?.[eventName]) {
                eventSource.on(eventTypes[eventName], refreshPromptInjection);
            }
        }
        if (eventTypes?.WORLDINFO_UPDATED) {
            eventSource.on(eventTypes.WORLDINFO_UPDATED, async () => {
                await refreshWorldNames();
            });
        }
        if (eventTypes?.CHAT_CHANGED) {
            eventSource.on(eventTypes.CHAT_CHANGED, async () => {
                lastProcessedLocationSignature = '';
                lastAppliedDetail = null;
                const settings = getSettings();
                if (!settings.selectedWorld && availableWorldNames.length) {
                    settings.selectedWorld = availableWorldNames[0];
                    saveSettings();
                }
                renderWorldOptions();
                await initializeCurrentChatLocation();
                refreshPromptInjection();
            });
        }
    }

    try {
        availableWorldNames = await fetchWorldNames();
    } catch {
        // Ignore - the dropdown can still populate from already loaded data.
    }

    renderWorldOptions();
    await loadSelectedWorld(getSelectedWorldName());
    setStatus(`Ready with ${Object.keys(getSettings().books || {}).length} lorebook(s) configured.`);
}

function startExtension() {
    if (typeof globalThis.$ !== 'function') {
        setTimeout(startExtension, 50);
        return;
    }

    initialize();

    const context = getSillyTavernContext();
    const eventSource = context?.eventSource;
    const eventTypes = context?.eventTypes ?? context?.event_types;

    if (eventSource && eventTypes?.APP_READY) {
        eventSource.on(eventTypes.APP_READY, initialize);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startExtension, { once: true });
} else {
    startExtension();
}
