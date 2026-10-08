// A small SVG string builder. Every helper returns markup, so a scene is a
// plain concatenation of parts. Numbers keep two decimals to stay compact.

type AttributeValue = string | number | undefined | false;

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Builds one element. Undefined and false attributes are left out. */
export function element(
  name: string,
  attributes: Record<string, AttributeValue>,
  children?: string,
): string {
  let result = `<${name}`;
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    const formatted = typeof value === "number" ? formatNumber(value) : escapeXml(value);
    result += ` ${key}="${formatted}"`;
  }
  return children === undefined ? `${result}/>` : `${result}>${children}</${name}>`;
}

export interface RectOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  fill?: string;
  /** An inside border, like a CSS border with `box-sizing: border-box`. */
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  /** A filter reference, for example `url(#shadow)`. */
  filter?: string;
}

export function rect({
  x,
  y,
  width,
  height,
  radius = 0,
  fill = "none",
  stroke,
  strokeWidth = 1,
  opacity,
  filter,
}: RectOptions): string {
  // An SVG stroke is centered on the outline. The inset keeps it inside the
  // box and on whole pixels.
  const inset = stroke ? strokeWidth / 2 : 0;
  return element("rect", {
    x: x + inset,
    y: y + inset,
    width: width - inset * 2,
    height: height - inset * 2,
    rx: radius ? Math.max(radius - inset, 0) : undefined,
    fill,
    stroke,
    "stroke-width": stroke && strokeWidth !== 1 ? strokeWidth : undefined,
    opacity,
    filter,
  });
}

export interface TextOptions {
  x: number;
  /** The vertical center of the text line. */
  y: number;
  value: string;
  fill: string;
  size?: number;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  mono?: boolean;
  italic?: boolean;
  /** Letter spacing in pixels. */
  spacing?: number;
}

export function text({
  x,
  y,
  value,
  fill,
  size = 14,
  weight = 400,
  anchor = "start",
  opacity,
  mono = false,
  italic = false,
  spacing,
}: TextOptions): string {
  return element(
    "text",
    {
      x,
      // The alphabetic baseline sits about 0.35 em below the visual center.
      y: y + size * 0.35,
      "font-size": size,
      "font-weight": weight === 400 ? undefined : weight,
      "font-style": italic ? "italic" : undefined,
      "text-anchor": anchor === "start" ? undefined : anchor,
      "font-family": mono ? "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" : undefined,
      "letter-spacing": spacing,
      fill,
      opacity,
    },
    escapeXml(value),
  );
}

export interface PathOptions {
  d: string;
  /** Offset of the path origin. */
  x?: number;
  y?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  opacity?: number;
  scale?: number;
}

export function path({
  d,
  x = 0,
  y = 0,
  stroke,
  strokeWidth = 1.5,
  fill = "none",
  opacity,
  scale,
}: PathOptions): string {
  const translate = x || y ? `translate(${formatNumber(x)} ${formatNumber(y)})` : "";
  const transform = `${translate}${scale ? ` scale(${formatNumber(scale)})` : ""}`.trim();
  return element("path", {
    d,
    transform: transform || undefined,
    fill,
    stroke,
    "stroke-width": stroke ? strokeWidth : undefined,
    "stroke-linecap": stroke ? "round" : undefined,
    "stroke-linejoin": stroke ? "round" : undefined,
    opacity,
  });
}

export interface CircleOptions {
  x: number;
  y: number;
  radius: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export function circle({ x, y, radius, fill = "none", stroke, strokeWidth = 1 }: CircleOptions) {
  return element("circle", {
    cx: x,
    cy: y,
    r: stroke ? radius - strokeWidth / 2 : radius,
    fill,
    stroke,
    "stroke-width": stroke && strokeWidth !== 1 ? strokeWidth : undefined,
  });
}

export function group(children: string, attributes: Record<string, AttributeValue> = {}): string {
  return element("g", attributes, children);
}

export interface ShadowOptions {
  /** The element identifier. It must be unique in the SVG document. */
  id: string;
  offsetY: number;
  blur: number;
  opacity: number;
}

/** A drop shadow filter definition. Reference it with `url(#id)`. */
export function shadowFilter({ id, offsetY, blur, opacity }: ShadowOptions): string {
  return element(
    "filter",
    { id, x: "-50%", y: "-50%", width: "200%", height: "200%" },
    element("feDropShadow", {
      dx: 0,
      dy: offsetY,
      stdDeviation: blur,
      "flood-color": "#000",
      "flood-opacity": opacity,
    }),
  );
}

const fontFamily = "system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

/** Wraps scene markup in a complete SVG document. */
export function svgDocument(width: number, height: number, body: string): string {
  return element(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      "font-family": fontFamily,
    },
    body,
  );
}

/**
 * Encodes an SVG document as a data URI. Every character that is unsafe in an
 * unquoted CSS `url()` is escaped, so the result works in `src`, in `srcset`,
 * and in a style value.
 */
export function toDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `data:image/svg+xml,${encoded}`;
}
