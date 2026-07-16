import { extension_settings, getContext } from '../../../extensions.js';
import { background_settings } from '../../../backgrounds.js';

const MODULE_NAME = 'location-background';
const MODULE_LABEL = 'Location Background Manager';
const SETTINGS_URL = new URL('./settings.html', import.meta.url);
const LOCATION_CHANGED_EVENT = 'location-background:changed';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    showToasts: false,
    selectedWorld: '',
    books: {},
});

let initialized = false;
let eventsRegistered = false;
let settingsRendered = false;
let activeWorldName = '';
let activeWorldData = null;
let availableWorldNames = [];
let lastAppliedSignature = '';
let lastAppliedDetail = null;
let lastStatusMessage = 'Starting...';

function getSillyTavernContext() {
    return getContext?.() ?? globalThis.SillyTavern?.getContext?.();
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
    return keys.length ? keys.join(', ') : `UID ${entry?.uid ?? '?'}`;
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

function setEntryMapping(worldName, entry, type, value) {
    const book = getBookStore(worldName, true);
    if (!book || !entry) {
        return;
    }

    const uid = String(entry.uid);
    if (!book.entries[uid]) {
        book.entries[uid] = {
            label: getEntryLabel(entry),
            background: '',
            music: '',
            weather: '',
        };
    }

    book.entries[uid].label = getEntryLabel(entry);
    book.entries[uid][type] = normalizeName(value);
    saveSettings();
    refreshSettingsUI();
}

function removeEntryMapping(worldName, uid, type = null) {
    const book = getBookStore(worldName, false);
    if (!book || !book.entries?.[String(uid)]) {
        return;
    }

    if (type) {
        delete book.entries[String(uid)][type];
    } else {
        delete book.entries[String(uid)];
    }

    if (type && book.entries[String(uid)]) {
        const mapping = book.entries[String(uid)];
        if (!mapping.background && !mapping.music && !mapping.weather) {
            delete book.entries[String(uid)];
        }
    }

    saveSettings();
    refreshSettingsUI();
}

function setStatus(message, isError = false) {
    lastStatusMessage = message;
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
            .text(`${getEntryLabel(entry)} (UID ${uid})`));
    }

    if (currentValue && availableEntries.some((entry) => String(entry.uid) === currentValue)) {
        picker.val(currentValue);
    }
}

function renderBackgroundDatalist() {
    const datalist = $('#location_background_backgrounds');
    if (!datalist.length) {
        return;
    }

    datalist.empty();
    for (const background of getAvailableBackgroundNames()) {
        datalist.append($('<option>').val(background));
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
        const label = entry ? getEntryLabel(entry) : normalizeName(mapping?.label) || `UID ${uid}`;
        const row = $('<tr>').attr('data-uid', uid);

        const labelCell = $('<td>');
        labelCell.append($('<div>').addClass('location-background-entry-title').text(label));
        labelCell.append($('<div>').addClass('location-background-entry-meta').text(`UID ${uid}`));

        const backgroundCell = $('<td>');
        backgroundCell.append($('<input>')
            .addClass('text_pole wide100p location-background-background-input')
            .attr('type', 'text')
            .attr('list', 'location_background_backgrounds')
            .attr('placeholder', 'Choose or type background filename')
            .val(normalizeName(mapping?.background)));

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

function refreshSettingsUI() {
    const settings = getSettings();
    const selectedWorld = getSelectedWorldName();

    $('#location_background_enabled').prop('checked', !!settings.enabled);
    $('#location_background_show_toasts').prop('checked', !!settings.showToasts);
    $('#location_background_world').val(selectedWorld);
    $('#location_background_world_count').text(String(availableWorldNames.length));
    $('#location_background_selected_world').text(selectedWorld || 'None');
    $('#location_background_entry_count').text(String(Object.keys(activeWorldData?.entries || {}).length));
    $('#location_background_status').text(lastStatusMessage);
    $('#location_background_last').text(lastAppliedDetail
        ? `${lastAppliedDetail.entryLabel} -> ${lastAppliedDetail.background || 'no background'}`
        : 'None yet');

    renderBackgroundDatalist();
    renderEntryPicker();
    renderLocationsList();
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
        setStatus(`Loaded lorebook "${normalizedWorld}" with ${Object.keys(activeWorldData?.entries || {}).length} entries.`);
        refreshSettingsUI();
    } catch (error) {
        activeWorldData = null;
        setStatus(error.message, true);
        showToast('warning', error.message);
        refreshSettingsUI();
    }
}

function onAddLocationClick() {
    const uid = normalizeName($('#location_background_entry_picker').val());
    const entry = getEntryByUid(uid);

    if (!entry) {
        setStatus('Select a lorebook entry first.', true);
        return;
    }

    setEntryMapping(activeWorldName, entry, 'background', '');
    setStatus(`Added location "${getEntryLabel(entry)}".`);
}

function onBackgroundInputChange(event) {
    const input = event.currentTarget;
    const row = input.closest('tr');
    const uid = row?.getAttribute('data-uid');
    const entry = getEntryByUid(uid) ?? { uid };

    if (!uid) {
        return;
    }

    setEntryMapping(activeWorldName, entry, 'background', input.value);
    setStatus(`Saved background for "${getEntryLabel(entry)}".`);
}

function onRemoveEntryClick(event) {
    const button = event.currentTarget;
    const row = button.closest('tr');
    const uid = row?.getAttribute('data-uid');

    if (!uid) {
        return;
    }

    removeEntryMapping(activeWorldName, uid, null);
    setStatus(`Removed entry UID ${uid} from the manager.`);
}

function bindSettingsEvents() {
    $('#location_background_enabled').on('change', function () {
        getSettings().enabled = !!$(this).prop('checked');
        saveSettings();
    });

    $('#location_background_show_toasts').on('change', function () {
        getSettings().showToasts = !!$(this).prop('checked');
        saveSettings();
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
    $('#location_background_locations_body').on('change', '.location-background-background-input', onBackgroundInputChange);
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

function applyBackgroundFallback(background) {
    const element = Array.from(document.querySelectorAll('.bg_example')).find((node) => normalizeName(node.getAttribute('bgfile')) === normalizeName(background));
    if (element instanceof HTMLElement) {
        element.click();
        return true;
    }

    const backgroundElement = document.getElementById('bg1');
    if (backgroundElement) {
        backgroundElement.style.backgroundImage = `url("backgrounds/${encodeURIComponent(background)}")`;
        background_settings.name = background;
        background_settings.url = `url("backgrounds/${encodeURIComponent(background)}")`;
        getSillyTavernContext()?.saveSettingsDebounced?.();
        return true;
    }

    return false;
}

function emitLocationChanged(detail) {
    window.dispatchEvent(new CustomEvent(LOCATION_CHANGED_EVENT, { detail }));
}

async function applyEntryMapping(entry, mapping) {
    const signature = JSON.stringify({
        world: activeWorldName,
        uid: entry.uid,
        background: mapping.background || '',
        music: mapping.music || '',
        weather: mapping.weather || '',
    });

    if (signature === lastAppliedSignature) {
        return;
    }

    let applied = true;
    if (mapping.background) {
        try {
            applied = await applyBackground(mapping.background);
        } catch (error) {
            warn(`Slash command /bg failed for "${mapping.background}". Trying fallback.`, error);
            applied = applyBackgroundFallback(mapping.background);
        }
    }

    if (!applied) {
        setStatus(`Could not apply background "${mapping.background}".`, true);
        return;
    }

    lastAppliedSignature = signature;
    const detail = {
        world: activeWorldName,
        entryUid: String(entry.uid),
        entryLabel: getEntryLabel(entry),
        background: mapping.background || null,
        music: mapping.music || null,
        weather: mapping.weather || null,
    };

    lastAppliedDetail = detail;
    emitLocationChanged(detail);
    setStatus(`Applied "${detail.entryLabel}" from "${activeWorldName}".`);
    $('#location_background_last').text(`${detail.entryLabel} -> ${detail.background || 'no background'}`);

    if (getSettings().showToasts) {
        showToast('info', `${detail.entryLabel} applied`);
    }

    log('Applied mapping', detail);
}

async function onWorldInfoActivated(entries) {
    if (!getSettings().enabled || !activeWorldName) {
        return;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
        return;
    }

    const mappings = getCurrentWorldMappings();
    for (const entry of entries) {
        const mapping = mappings[String(entry?.uid)];
        if (mapping && (mapping.background || mapping.music || mapping.weather)) {
            await applyEntryMapping(entry, mapping);
            return;
        }
    }
}

function registerDebugApi() {
    globalThis.locationBackgroundManager = {
        reload: async () => {
            await refreshWorldNames();
        },
        selectWorld: async (worldName) => {
            $('#location_background_world').val(worldName).trigger('change');
        },
        setMapping: (worldName, uid, type, value) => {
            const book = getBookStore(worldName, true);
            const entry = activeWorldData?.entries?.[String(uid)] ?? { uid };
            if (!book.entries[String(uid)]) {
                book.entries[String(uid)] = { label: `UID ${uid}`, background: '', music: '', weather: '' };
            }
            book.entries[String(uid)][type] = normalizeName(value);
            saveSettings();
            refreshSettingsUI();
        },
        removeMapping: (worldName, uid, type = null) => removeEntryMapping(worldName, uid, type),
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

    if (eventSource && eventTypes?.WORLD_INFO_ACTIVATED && !eventsRegistered) {
        eventsRegistered = true;
        eventSource.on(eventTypes.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
        if (eventTypes.WORLDINFO_UPDATED) {
            eventSource.on(eventTypes.WORLDINFO_UPDATED, async () => {
                await refreshWorldNames();
            });
        }
        if (eventTypes.CHAT_CHANGED) {
            eventSource.on(eventTypes.CHAT_CHANGED, async () => {
                const settings = getSettings();
                if (!settings.selectedWorld && availableWorldNames.length) {
                    settings.selectedWorld = availableWorldNames[0];
                    saveSettings();
                }
                renderWorldOptions();
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
