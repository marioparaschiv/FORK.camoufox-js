/**
 * Per-context fingerprint helpers for CloverLabs Camoufox builds.
 *
 * These utilities generate `addInitScript` code that calls the self-destructing
 * `window.setXxx()` functions available in CloverLabs builds with per-context
 * fingerprint isolation.
 *
 * Usage with Playwright:
 *   const context = await browser.newContext();
 *   await applyContextFingerprint(context, fingerprint);
 *
 * Or apply individual overrides:
 *   await context.addInitScript(setCanvasSeed(12345));
 */
/** Generate init script for per-context canvas fingerprint seed */
export declare function setCanvasSeed(seed: number): string;
/** Generate init script for per-context audio fingerprint seed */
export declare function setAudioFingerprintSeed(seed: number): string;
/** Generate init script for per-context font spacing seed */
export declare function setFontSpacingSeed(seed: number): string;
/** Generate init script for per-context font list */
export declare function setFontList(fonts: string[]): string;
/** Generate init script for per-context navigator.platform */
export declare function setNavigatorPlatform(platform: string): string;
/** Generate init script for per-context navigator.oscpu */
export declare function setNavigatorOscpu(oscpu: string): string;
/** Generate init script for per-context navigator.hardwareConcurrency */
export declare function setNavigatorHardwareConcurrency(cores: number): string;
/** Generate init script for per-context WebGL vendor */
export declare function setWebGLVendor(vendor: string): string;
/** Generate init script for per-context WebGL renderer */
export declare function setWebGLRenderer(renderer: string): string;
/** Generate init script for per-context screen dimensions */
export declare function setScreenDimensions(width: number, height: number): string;
/** Generate init script for per-context screen color depth */
export declare function setScreenColorDepth(depth: number): string;
/** Generate init script for per-context screen available dimensions */
export declare function setScreenAvailDimensions(width: number, height: number): string;
/** Generate init script for per-context timezone */
export declare function setTimezone(tz: string): string;
/** Generate init script for per-context speech voices */
export declare function setSpeechVoices(voices: string[]): string;
/** Generate init script for per-context WebRTC IPv4 */
export declare function setWebRTCIPv4(ip: string): string;
/** Generate init script for per-context WebRTC IPv6 */
export declare function setWebRTCIPv6(ip: string): string;
/**
 * Configuration for per-context fingerprint overrides.
 * All fields are optional - only provided fields will be applied.
 */
export interface ContextFingerprint {
    /** Canvas fingerprint seed */
    canvasSeed?: number;
    /** Audio fingerprint seed */
    audioSeed?: number;
    /** Font spacing seed */
    fontSpacingSeed?: number;
    /** List of fonts to appear "installed" */
    fonts?: string[];
    /** navigator.platform value */
    platform?: string;
    /** navigator.oscpu value */
    oscpu?: string;
    /** navigator.hardwareConcurrency (CPU cores) */
    hardwareConcurrency?: number;
    /** WebGL UNMASKED_VENDOR_WEBGL */
    webglVendor?: string;
    /** WebGL UNMASKED_RENDERER_WEBGL */
    webglRenderer?: string;
    /** Screen width and height */
    screen?: {
        width: number;
        height: number;
    };
    /** Screen color depth */
    colorDepth?: number;
    /** Available screen dimensions */
    availScreen?: {
        width: number;
        height: number;
    };
    /** Timezone identifier (e.g. "America/New_York") */
    timezone?: string;
    /** Speech synthesis voices list */
    speechVoices?: string[];
    /** WebRTC IPv4 address */
    webrtcIPv4?: string;
    /** WebRTC IPv6 address */
    webrtcIPv6?: string;
}
/**
 * Apply per-context fingerprint overrides to a Playwright BrowserContext.
 * Only works with CloverLabs Camoufox builds that support per-context spoofing.
 *
 * Uses optional chaining (`?.`) so calls are silently ignored on standard builds.
 */
export declare function applyContextFingerprint(context: {
    addInitScript: (script: string) => Promise<void>;
}, fingerprint: ContextFingerprint): Promise<void>;
