// from browserforge.fingerprints import Fingerprint, Screen
// from screeninfo import get_monitors
// from ua_parser import user_agent_parser
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { UAParser } from "ua-parser-js";
import { addDefaultAddons, confirmPaths, } from "./addons.js";
import { InvalidOS, InvalidPropertyType, NonFirefoxFingerprint, UnknownProperty, } from "./exceptions.js";
import { fromBrowserforge, generateFingerprint, SUPPORTED_OS, } from "./fingerprints.js";
import { publicIP, validIPv4, validIPv6 } from "./ip.js";
import { geoipAllowed, getGeolocation, handleLocales } from "./locale.js";
import FONTS from "./mappings/fonts.config.js";
import { getPath, installedVerStr, launchPath, OS_NAME } from "./pkgman.js";
import { LeakWarning } from "./warnings.js";
import { sampleWebGL } from "./webgl/sample.js";
// Camoufox preferences to cache previous pages and requests
const CACHE_PREFS = {
    "browser.sessionhistory.max_entries": 10,
    "browser.sessionhistory.max_total_viewers": -1,
    "browser.cache.memory.enable": true,
    "browser.cache.disk_cache_ssl": true,
    "browser.cache.disk.smart_size.enabled": true,
};
function getEnvVars(configMap, userAgentOS) {
    const envVars = {};
    let updatedConfigData;
    try {
        updatedConfigData = new TextEncoder().encode(JSON.stringify(configMap));
    }
    catch (e) {
        console.error(`Error updating config: ${e}`);
        process.exit(1);
    }
    const chunkSize = OS_NAME === "win" ? 2047 : 32767;
    const configStr = new TextDecoder().decode(updatedConfigData);
    for (let i = 0; i < configStr.length; i += chunkSize) {
        const chunk = configStr.slice(i, i + chunkSize);
        const envName = `CAMOU_CONFIG_${Math.floor(i / chunkSize) + 1}`;
        try {
            envVars[envName] = chunk;
        }
        catch (e) {
            console.error(`Error setting ${envName}: ${e}`);
            process.exit(1);
        }
    }
    if (OS_NAME === "lin") {
        const directoryMap = {
            lin: "linux",
            mac: "macos",
            win: "windows",
        };
        const osDir = directoryMap[userAgentOS] ?? userAgentOS;
        const fontconfigPath = getPath(path.join("fontconfigs", osDir));
        // Validate fonts.conf exists
        const fontsConf = path.join(fontconfigPath, "fonts.conf");
        if (!existsSync(fontsConf)) {
            throw new Error(`fonts.conf not found in ${fontconfigPath}! Something is wrong with your camoufox bundle.`);
        }
        envVars.FONTCONFIG_PATH = fontconfigPath;
    }
    return envVars;
}
export function getAsBooleanFromENV(name, defaultValue) {
    const value = process.env[name];
    if (value === "false" || value === "0")
        return false;
    if (value)
        return true;
    return !!defaultValue;
}
function loadProperties(filePath) {
    let propFile;
    filePath = filePath?.toString();
    if (filePath) {
        propFile = path.join(path.dirname(filePath), "properties.json");
    }
    else {
        propFile = getPath("properties.json");
    }
    const propData = readFileSync(propFile).toString();
    const propDict = JSON.parse(propData);
    return propDict.reduce((acc, prop) => {
        acc[prop.property] = prop.type;
        return acc;
    }, {});
}
function validateConfig(configMap, path) {
    const propertyTypes = loadProperties(path);
    for (const [key, value] of Object.entries(configMap)) {
        const expectedType = propertyTypes[key];
        if (!expectedType) {
            throw new UnknownProperty(`Unknown property ${key} in config`);
        }
        if (!validateType(value, expectedType)) {
            throw new InvalidPropertyType(`Invalid type for property ${key}. Expected ${expectedType}, got ${typeof value}`);
        }
    }
}
function validateType(value, expectedType) {
    switch (expectedType) {
        case "str":
            return typeof value === "string";
        case "int":
            return Number.isInteger(value);
        case "uint":
            return Number.isInteger(value) && value >= 0;
        case "double":
            return typeof value === "number";
        case "bool":
            return typeof value === "boolean";
        case "array":
            return Array.isArray(value);
        case "dict":
            return (typeof value === "object" && value !== null && !Array.isArray(value));
        default:
            return false;
    }
}
function getTargetOS(config) {
    if (config["navigator.userAgent"]) {
        return determineUAOS(config["navigator.userAgent"]);
    }
    return OS_NAME;
}
function determineUAOS(userAgent) {
    const parser = new UAParser(userAgent);
    const parsedUA = parser.getOS().name;
    if (!parsedUA) {
        throw new Error("Could not determine OS from user agent");
    }
    if (parsedUA.startsWith("macOS")) {
        return "mac";
    }
    if (parsedUA.startsWith("Windows")) {
        return "win";
    }
    return "lin";
}
function getScreenCons(headless) {
    if (headless === false) {
        return undefined;
    }
    // TODO - Implement getMonitors
    // try {
    //     const monitors = getMonitors();
    //     if (!monitors.length) {
    //         return undefined;
    //     }
    //     const monitor = monitors.reduce((prev, curr) => (prev.width * prev.height > curr.width * curr.height ? prev : curr));
    //     return { maxWidth: monitor.width, maxHeight: monitor.height };
    // } catch {
    //     return undefined;
    // }
    return undefined;
}
function updateFonts(config, targetOS) {
    const fonts = FONTS[targetOS];
    if (config.fonts) {
        config.fonts = Array.from(new Set([...fonts, ...config.fonts]));
    }
    else {
        config.fonts = fonts;
    }
}
function checkCustomFingerprint(fingerprint) {
    const parser = new UAParser(fingerprint.navigator.userAgent);
    const browserName = parser.getBrowser().name || "Non-Firefox";
    if (browserName !== "Firefox") {
        throw new NonFirefoxFingerprint(`"${browserName}" fingerprints are not supported in Camoufox. Using fingerprints from a browser other than Firefox WILL lead to detection. If this is intentional, pass i_know_what_im_doing=True.`);
    }
    LeakWarning.warn("custom_fingerprint", false);
}
function validateOS(os) {
    if (!os)
        return undefined;
    if (Array.isArray(os)) {
        os.every(validateOS);
        return [...os];
    }
    // Assert that the OS is lowercase
    if (os !== os.toLowerCase()) {
        throw new InvalidOS(`OS values must be lowercase: '${os}'`);
    }
    if (!SUPPORTED_OS.includes(os)) {
        throw new InvalidOS(`Camoufox does not support the OS: '${os}'`);
    }
    return [os];
}
function _cleanLocals(data) {
    delete data.playwright;
    delete data.persistentContext;
    return data;
}
function mergeInto(target, source) {
    Object.entries(source).forEach(([key, value]) => {
        if (!(key in target)) {
            target[key] = value;
        }
    });
}
function setInto(target, key, value) {
    if (!(key in target)) {
        target[key] = value;
    }
}
function isDomainSet(config, ...properties) {
    return properties.some((prop) => {
        if (prop.endsWith(".") || prop.endsWith(":")) {
            return Object.keys(config).some((key) => key.startsWith(prop));
        }
        return prop in config;
    });
}
function warnManualConfig(config) {
    if (isDomainSet(config, "navigator.language", "navigator.languages", "headers.Accept-Language", "locale:")) {
        LeakWarning.warn("locale", false);
    }
    if (isDomainSet(config, "geolocation:", "timezone")) {
        LeakWarning.warn("geolocation", false);
    }
    if (isDomainSet(config, "headers.User-Agent")) {
        LeakWarning.warn("header-ua", false);
    }
    if (isDomainSet(config, "navigator.")) {
        LeakWarning.warn("navigator", false);
    }
    if (isDomainSet(config, "screen.", "window.", "document.body.")) {
        LeakWarning.warn("viewport", false);
    }
}
async function _asyncAttachVD(browser, virtualDisplay) {
    if (!virtualDisplay) {
        return browser;
    }
    const originalClose = browser.close;
    browser.close = async (...args) => {
        try {
            await originalClose.apply(browser, ...args);
        }
        finally {
            if (virtualDisplay) {
                virtualDisplay.kill();
            }
        }
    };
    browser._virtualDisplay = virtualDisplay;
    return browser;
}
export function syncAttachVD(browser, virtualDisplay) {
    /**
     * Attaches the virtual display to the sync browser cleanup
     */
    if (!virtualDisplay) {
        // Skip if no virtual display is provided
        return browser;
    }
    const originalClose = browser.close;
    browser.close = (...args) => {
        try {
            originalClose.apply(browser, ...args);
        }
        finally {
            if (virtualDisplay) {
                virtualDisplay.kill();
            }
        }
    };
    browser._virtualDisplay = virtualDisplay;
    return browser;
}
/**
 * Convert a Playwright proxy string to a URL object.
 *
 * Implementation from https://github.com/microsoft/playwright/blob/3873b72ac1441ca691f7594f0ed705bd84518f93/packages/playwright-core/src/server/browserContext.ts#L737-L747
 */
function getProxyUrl(proxy) {
    if (!proxy)
        return null;
    if (typeof proxy === "string") {
        return new URL(proxy);
    }
    const { server, username, password } = proxy;
    let url;
    try {
        // new URL('127.0.0.1:8080') throws
        // new URL('localhost:8080') fails to parse host or protocol
        // In both of these cases, we need to try re-parse URL with `http://` prefix.
        url = new URL(server);
        if (!url.host || !url.protocol)
            url = new URL(`http://${server}`);
    }
    catch (_e) {
        url = new URL(`http://${server}`);
    }
    if (username)
        url.username = username;
    if (password)
        url.password = password;
    return url;
}
/**
 * Prepare launch options for Playwright's Firefox browser.
 *
 * Note: This function only accepts `boolean` for the `headless` parameter.
 * Callers must normalize `"virtual"` to `boolean` before calling this function.
 * The virtual display setup is handled separately in the calling function.
 */
export async function launchOptions({ config, os, block_images, block_webrtc, block_webgl, disable_coop, webgl_config, geoip, geoip_db, humanize, locale, addons, fonts, custom_fonts_only, exclude_addons, screen, window, fingerprint, ff_version, headless, main_world_eval, executable_path, firefox_user_prefs, proxy, enable_cache, args, env, i_know_what_im_doing, debug, virtual_display, ...launch_options }) {
    // Build the config
    if (!config) {
        config = {};
    }
    // Set default values for optional arguments
    const headlessBoolean = headless ?? false;
    if (!addons) {
        addons = [];
    }
    if (!args) {
        args = [];
    }
    if (!firefox_user_prefs) {
        firefox_user_prefs = {};
    }
    if (custom_fonts_only === undefined) {
        custom_fonts_only = false;
    }
    if (i_know_what_im_doing === undefined) {
        i_know_what_im_doing = false;
    }
    if (!env) {
        env = process.env;
    }
    if (typeof executable_path === "string") {
        // Convert executable path to a Path object
        executable_path = path.resolve(executable_path);
    }
    // Handle virtual display
    if (virtual_display) {
        env.DISPLAY = virtual_display;
    }
    // Warn the user for manual config settings
    if (!i_know_what_im_doing) {
        warnManualConfig(config);
    }
    const operatingSystems = validateOS(os);
    // webgl_config requires OS to be set
    if (!operatingSystems && webgl_config) {
        throw new Error("OS must be set when using webgl_config");
    }
    // Add the default addons
    await addDefaultAddons(addons, exclude_addons);
    // Confirm all addon paths are valid
    if (addons.length > 0) {
        confirmPaths(addons);
        config.addons = addons;
    }
    // Get the Firefox version
    let ff_version_str;
    if (ff_version) {
        ff_version_str = ff_version.toString();
        LeakWarning.warn("ff_version", i_know_what_im_doing);
    }
    else {
        ff_version_str = installedVerStr().split(".", 1)[0];
    }
    // Generate a fingerprint
    if (!fingerprint) {
        fingerprint = generateFingerprint(window, {
            screen: screen || getScreenCons(headlessBoolean || "DISPLAY" in env),
            operatingSystems,
        });
    }
    else {
        // Or use the one passed by the user
        if (!i_know_what_im_doing) {
            checkCustomFingerprint(fingerprint);
        }
    }
    // Inject the fingerprint into the config
    mergeInto(config, fromBrowserforge(fingerprint, ff_version_str));
    const targetOS = getTargetOS(config);
    // Set a random window.history.length
    setInto(config, "window.history.length", Math.floor(Math.random() * 5) + 1);
    // Update fonts list
    if (fonts) {
        config.fonts = fonts;
    }
    if (custom_fonts_only) {
        firefox_user_prefs["gfx.bundled-fonts.activate"] = 0;
        if (fonts) {
            // The user has passed their own fonts, and OS fonts are disabled.
            LeakWarning.warn("custom_fonts_only");
        }
        else {
            // OS fonts are disabled, and the user has not passed their own fonts either.
            throw new Error("No custom fonts were passed, but `custom_fonts_only` is enabled.");
        }
    }
    else {
        updateFonts(config, targetOS);
    }
    // Set a fixed font spacing seed
    setInto(config, "fonts:spacing_seed", Math.floor(Math.random() * 1_073_741_824));
    // Set canvas and audio seeds (used by CloverLabs builds for per-context spoofing).
    // Only set if the binary's properties.json supports them.
    const knownProperties = loadProperties(executable_path);
    if ("canvas:seed" in knownProperties) {
        setInto(config, "canvas:seed", Math.floor(Math.random() * 1_073_741_824));
    }
    if ("audio:seed" in knownProperties) {
        setInto(config, "audio:seed", Math.floor(Math.random() * 1_073_741_824));
    }
    // Handle proxy
    const proxyUrl = getProxyUrl(proxy);
    // Set geolocation
    if (geoip) {
        geoipAllowed();
        if (geoip === true) {
            // Find the user's IP address
            if (proxyUrl) {
                geoip = await publicIP(proxyUrl.href);
            }
            else {
                geoip = await publicIP();
            }
        }
        // Spoof WebRTC if not blocked
        if (!block_webrtc) {
            if (validIPv4(geoip)) {
                setInto(config, "webrtc:ipv4", geoip);
                firefox_user_prefs["network.dns.disableIPv6"] = true;
            }
            else if (validIPv6(geoip)) {
                setInto(config, "webrtc:ipv6", geoip);
            }
        }
        const geolocation = await getGeolocation(geoip, geoip_db);
        Object.assign(config, geolocation.asConfig());
    }
    // Raise a warning when a proxy is being used without spoofing geolocation.
    // This is a very bad idea; the warning cannot be ignored with i_know_what_im_doing.
    else if (proxyUrl &&
        !proxyUrl.hostname.includes("localhost") &&
        !isDomainSet(config, "geolocation:")) {
        LeakWarning.warn("proxy_without_geoip");
    }
    // Set locale
    if (locale) {
        handleLocales(locale, config);
    }
    // Pass the humanize option
    if (humanize) {
        setInto(config, "humanize", true);
        if (typeof humanize === "number") {
            setInto(config, "humanize:maxTime", humanize);
        }
    }
    // Enable the main world context creation
    if (main_world_eval) {
        setInto(config, "allowMainWorld", true);
    }
    // Set Firefox user preferences
    if (block_images) {
        LeakWarning.warn("block_images", i_know_what_im_doing);
        firefox_user_prefs["permissions.default.image"] = 2;
    }
    if (block_webrtc) {
        firefox_user_prefs["media.peerconnection.enabled"] = false;
    }
    if (disable_coop) {
        LeakWarning.warn("disable_coop", i_know_what_im_doing);
        firefox_user_prefs["browser.tabs.remote.useCrossOriginOpenerPolicy"] =
            false;
    }
    // Allow allow_webgl parameter for backwards compatibility
    if (block_webgl || launch_options.allow_webgl === false) {
        firefox_user_prefs["webgl.disabled"] = true;
        LeakWarning.warn("block_webgl", i_know_what_im_doing);
    }
    else {
        // If the user has provided a specific WebGL vendor/renderer pair, use it
        let webgl_fp;
        if (webgl_config) {
            webgl_fp = await sampleWebGL(targetOS, ...webgl_config);
        }
        else {
            webgl_fp = await sampleWebGL(targetOS);
        }
        const { webGl2Enabled, ...webGlConfig } = webgl_fp;
        // Merge the WebGL fingerprint into the config
        mergeInto(config, webGlConfig);
        // Set the WebGL preferences
        mergeInto(firefox_user_prefs, {
            "webgl.enable-webgl2": webGl2Enabled,
            "webgl.force-enabled": true,
        });
    }
    // Cache previous pages, requests, etc (uses more memory)
    if (enable_cache) {
        mergeInto(firefox_user_prefs, CACHE_PREFS);
    }
    // Print the config if debug is enabled
    if (debug) {
        console.debug("[DEBUG] Config:");
        console.debug(config);
    }
    // Validate the config
    validateConfig(config, executable_path);
    // On non-Linux, the Camoufox binary's C++ ICU timezone patch
    // (timezone-spoofing.patch) crashes due to a reinterpret_cast from
    // char16_t* to char* in TimeZone.cpp. Extract timezone from the config
    // and pass it via Playwright's timezoneId context option instead.
    // TODO: Remove this workaround once the Camoufox binary fixes the
    // timezone-spoofing.patch for non-Linux platforms.
    let _timezoneId;
    if (OS_NAME !== "lin" && "timezone" in config) {
        _timezoneId = config.timezone;
        delete config.timezone;
    }
    // Prepare environment variables to pass to Camoufox
    const env_vars = {
        ...getEnvVars(config, targetOS),
        ...env,
    };
    // Prepare the executable path
    if (executable_path) {
        executable_path = executable_path.toString();
    }
    else {
        executable_path = launchPath();
    }
    const out = {
        executablePath: executable_path,
        args: args,
        env: env_vars,
        firefoxUserPrefs: firefox_user_prefs,
        headless: headlessBoolean,
        ...launch_options,
    };
    if (_timezoneId) {
        out._timezoneId = _timezoneId;
    }
    // Only include proxy if defined (Playwright 1.55+ validates this)
    if (proxyUrl) {
        out.proxy = {
            server: proxyUrl.origin,
            username: proxyUrl.username,
            password: proxyUrl.password,
            bypass: typeof proxy === "string" ? undefined : proxy?.bypass,
        };
    }
    return out;
}
