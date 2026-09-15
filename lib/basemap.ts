import type {
  ExpressionSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { Theme } from "@/lib/theme";

/**
 * OpenFreeMap's styles, free and keyless: Liberty for the OpenStreetMap look,
 * and its dark style at night.
 */
const STYLES: Record<Theme, { url: string; sea: string }> = {
  // OpenStreetMap's own aqua, which the sunny filter was tuned for, over the
  // style's brighter blue.
  light: { url: "https://tiles.openfreemap.org/styles/liberty", sea: "#aad3df" },
  // The dark style's sea is as grey as its land; a deep teal keeps the coast.
  dark: { url: "https://tiles.openfreemap.org/styles/dark", sea: "#17313a" },
};

/** English where OpenStreetMap has it, else the name in Latin letters. */
const ENGLISH_NAME: ExpressionSpecification = [
  "coalesce",
  ["get", "name:en"],
  ["get", "name:latin"],
  ["get", "name"],
];

// OpenMapTiles and OpenStreetMap are required; OpenFreeMap asks for none.
export const BASEMAP_ATTRIBUTION = [
  '<a href="https://www.openmaptiles.org/">© OpenMapTiles</a>',
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
  '<a href="https://www.eea.europa.eu/">EEA</a>',
].join(" · ");

const loaded = new Map<Theme, Promise<StyleSpecification>>();

/**
 * The basemap style with every label in English and without the shop, peak
 * and transit icons, which read as beaches at a glance. Fetched once a theme.
 */
export function loadBasemapStyle(theme: Theme): Promise<StyleSpecification> {
  let style = loaded.get(theme);
  if (!style) {
    style = fetchStyle(theme);
    // A failed fetch is tried again next time rather than remembered.
    style.catch(() => loaded.delete(theme));
    loaded.set(theme, style);
  }
  return style;
}

async function fetchStyle(theme: Theme): Promise<StyleSpecification> {
  const { url, sea } = STYLES[theme];
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Basemap style: ${response.status}`);
  const style = (await response.json()) as StyleSpecification;

  style.layers = style.layers
    .filter((layer) => !layer.id.startsWith("poi"))
    .map((layer) => {
      if (layer.id === "water" && layer.type === "fill") {
        return { ...layer, paint: { ...layer.paint, "fill-color": sea } };
      }
      if (layer.type !== "symbol") return layer;
      const text = layer.layout?.["text-field"];
      // Road shields print a ref, not a name, and stay as they are.
      if (!text || !JSON.stringify(text).includes("name")) return layer;
      return { ...layer, layout: { ...layer.layout, "text-field": ENGLISH_NAME } };
    });
  return style;
}
