import { firefox, } from "playwright-core";
import { launchOptions, syncAttachVD } from "./utils.js";
import { VirtualDisplay } from "./virtdisplay.js";
export async function Camoufox(launch_options = {}) {
    const { headless, user_data_dir, ...launchOptions } = launch_options;
    return NewBrowser(firefox, headless, {}, user_data_dir ?? false, false, launchOptions);
}
export async function NewBrowser(playwright, headless = false, fromOptions = {}, userDataDir = false, debug = false, launch_options = {}) {
    let virtualDisplay = null;
    // Normalize headless to boolean and prepare options for launchOptions function
    const normalizedHeadless = headless === "virtual" ? false : headless || false;
    if (headless === "virtual") {
        virtualDisplay = new VirtualDisplay(debug);
        launch_options.virtual_display = virtualDisplay.get();
    }
    if (!fromOptions || Object.keys(fromOptions).length === 0) {
        fromOptions = await launchOptions({
            debug,
            ...launch_options,
            headless: normalizedHeadless,
        });
    }
    // Extract _timezoneId (non-Linux workaround for Camoufox binary timezone crash).
    // TODO: Remove once the Camoufox binary fixes timezone-spoofing.patch.
    const timezoneId = fromOptions._timezoneId;
    delete fromOptions._timezoneId;
    if (typeof userDataDir === "string") {
        const context = await playwright.launchPersistentContext(userDataDir, { ...fromOptions, ...(timezoneId ? { timezoneId } : {}) });
        return syncAttachVD(context, virtualDisplay);
    }
    const browser = await playwright.launch(fromOptions);
    // Monkey-patch newContext to inject timezoneId on non-Linux.
    // TODO: Remove once the Camoufox binary fixes timezone-spoofing.patch.
    if (timezoneId) {
        const originalNewContext = browser.newContext.bind(browser);
        browser.newContext = (options) => originalNewContext({ timezoneId, ...options });
    }
    return syncAttachVD(browser, virtualDisplay);
}
