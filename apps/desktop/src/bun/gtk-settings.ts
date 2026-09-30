import type { GtkSettings, GtkTitleButtonRaster } from "../shared/bridge.js";

type JsonObject = { [key: string]: unknown };
type ButtonState = GtkSettings["button"]["normal"];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function parseTitleButtonRaster(value: unknown): GtkTitleButtonRaster | undefined {
  if (!isObject(value) || !isFiniteNumber(value.width) || !isFiniteNumber(value.height) ||
      !isString(value.normal) || !isString(value.hover) || !isString(value.active) || !isString(value.disabled)) {
    return undefined;
  }
  return {
    width: value.width,
    height: value.height,
    normal: value.normal,
    hover: value.hover,
    active: value.active,
    disabled: value.disabled,
  };
}

function parseButtonState(value: unknown): ButtonState | undefined {
  if (!isObject(value) || !isString(value.foreground) || !isString(value.background)) return undefined;
  return { foreground: value.foreground, background: value.background };
}

/** Validate and copy the GTK helper's process output into the bridge contract. */
export function parseGtkSettings(value: unknown): GtkSettings | undefined {
  if (!isObject(value)) return undefined;

  const gtk = value.gtk;
  const window = value.window;
  const decorationLayout = isObject(window) ? window.decorationLayout : undefined;
  const icons = value.icons;
  const titleButtons = value.titleButtons;
  const button = value.button;
  const headerbar = value.headerbar;
  if (!isObject(gtk) || gtk.version !== 3 || !isString(gtk.theme) || !isString(gtk.iconTheme) ||
      !isString(gtk.font) || !isString(gtk.fontFamily) || typeof gtk.dark !== "boolean" ||
      !isObject(decorationLayout) || !isString(decorationLayout.layout) ||
      !isStringArray(decorationLayout.left) || !isStringArray(decorationLayout.right) ||
      !isObject(icons) || !isString(icons.menu) ||
      !isObject(titleButtons) || !isFiniteNumber(titleButtons.spacing) ||
      !isObject(button) || !isObject(headerbar)) {
    return undefined;
  }

  const minimize = parseTitleButtonRaster(titleButtons.minimize);
  const maximize = parseTitleButtonRaster(titleButtons.maximize);
  const restore = parseTitleButtonRaster(titleButtons.restore);
  const close = parseTitleButtonRaster(titleButtons.close);
  const normal = parseButtonState(button.normal);
  const hover = parseButtonState(button.hover);
  const active = parseButtonState(button.active);
  const disabled = parseButtonState(button.disabled);
  if (!minimize || !maximize || !restore || !close || !normal || !hover || !active || !disabled ||
      !isString(headerbar.background) || !isString(headerbar.foreground) || !isFiniteNumber(headerbar.height)) {
    return undefined;
  }

  return {
    gtk: {
      version: 3,
      theme: gtk.theme,
      iconTheme: gtk.iconTheme,
      font: gtk.font,
      fontFamily: gtk.fontFamily,
      dark: gtk.dark,
    },
    window: {
      decorationLayout: {
        layout: decorationLayout.layout,
        left: [...decorationLayout.left],
        right: [...decorationLayout.right],
      },
    },
    icons: { menu: icons.menu },
    titleButtons: { spacing: titleButtons.spacing, minimize, maximize, restore, close },
    button: { normal, hover, active, disabled },
    headerbar: {
      background: headerbar.background,
      foreground: headerbar.foreground,
      height: headerbar.height,
    },
  };
}
