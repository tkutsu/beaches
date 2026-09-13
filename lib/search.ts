import type { Beach } from "@/lib/types";

// Beach names come in each country's own language and script: Cyrillic in
// Bulgaria, diacritics across most of Europe, and Latin transliterations for
// Greece. Names and queries are folded to the same plain-Latin form so a
// visitor can type either the native spelling or a Latin one.
const GREEK_TO_LATIN: Record<string, string> = {
  Α: "A", Β: "V", Γ: "G", Δ: "D", Ε: "E", Ζ: "Z", Η: "I", Θ: "TH",
  Ι: "I", Κ: "K", Λ: "L", Μ: "M", Ν: "N", Ξ: "X", Ο: "O", Π: "P",
  Ρ: "R", Σ: "S", Τ: "T", Υ: "Y", Φ: "F", Χ: "CH", Ψ: "PS", Ω: "O",
};

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ж: "ZH", З: "Z",
  И: "I", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P",
  Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "H", Ц: "TS", Ч: "CH",
  Ш: "SH", Щ: "SHT", Ъ: "A", Ы: "Y", Ь: "", Э: "E", Ю: "YU", Я: "YA",
  Ё: "E", І: "I", Ї: "I", Є: "E", Ґ: "G",
};

export function fold(text: string): string {
  const upper = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    // Word-initial μπ/ντ/γκ sound like B/D/G in Greek place names.
    .replace(/(^|[\s\-.])ΜΠ/g, "$1B")
    .replace(/(^|[\s\-.])ΝΤ/g, "$1D")
    .replace(/(^|[\s\-.])ΓΚ/g, "$1G");

  let result = "";
  for (const character of upper) {
    result +=
      GREEK_TO_LATIN[character] ??
      CYRILLIC_TO_LATIN[character] ??
      character;
  }
  // The EEA mixes OU and OY for the same Greek sound.
  return result.replace(/OU/g, "OY").trim();
}

const foldedNames = new WeakMap<readonly Beach[], string[]>();

export function searchBeaches(
  beaches: readonly Beach[],
  query: string,
  limit: number,
): Beach[] {
  const needle = fold(query);
  if (!needle) return [];

  let names = foldedNames.get(beaches);
  if (!names) {
    names = beaches.map((beach) =>
      beach.a ? `${fold(beach.name)}\n${fold(beach.a)}` : fold(beach.name),
    );
    foldedNames.set(beaches, names);
  }

  const startsWith: Beach[] = [];
  const contains: Beach[] = [];
  for (let index = 0; index < beaches.length; index += 1) {
    const position = names[index].indexOf(needle);
    if (position === -1) continue;
    // Position 0, or the start of the transliterated alias on the second line.
    if (position === 0 || names[index][position - 1] === "\n") {
      startsWith.push(beaches[index]);
      if (startsWith.length >= limit) break;
    } else {
      contains.push(beaches[index]);
    }
  }
  return [...startsWith, ...contains].slice(0, limit);
}
