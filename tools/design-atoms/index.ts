#!/usr/bin/env tsx
/**
 * Generates the static parts of Rainbow design system from its tokens:
 *
 *   src/design/atoms.ts             static style atoms (Tailwind names, numeric suffixes, D2)
 *   src/design/capsizeTable.ts precomputed Capsize trims for every `typeHierarchy` entry, plus a metrics index
 *
 * Usage:
 *   bun run design:atoms          # regenerate both files
 *   bun run lint:design           # --check: exit 1 if either file is stale (part of `bun run lint`)
 *
 * The output is formatted with the repo's Prettier config so `format:check`
 * and `--check` agree. Never edit the generated files by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { precomputeValues } from '@capsizecss/core';
import * as prettier from 'prettier';

import { borderRadius, fontSize, fontWeight, lineHeight, space } from '../../src/design/tokens';
import { typeHierarchy } from '../../src/design/type-hierarchy';

const ROOT = path.resolve(__dirname, '../..');
const ATOMS_FILE = path.join(ROOT, 'src/design/atoms.ts');
const CAPSIZE_FILE = path.join(ROOT, 'src/design/capsizeTable.ts');

// Sourced from https://seek-oss.github.io/capsize, same as design-system/typography/typography.ts
const fontMetrics = {
  capHeight: 1443,
  ascent: 1950,
  descent: -494,
  lineGap: 0,
  unitsPerEm: 2048,
} as const;

type StyleValue = string | number;
type Atom = Record<string, StyleValue>;

const HEADER = `/**
 * GENERATED FILE. DO NOT EDIT.
 * Source: tools/design-atoms (run \`bun run design:atoms\` to regenerate, \`bun run lint:design\` to check).
 */`;

function suffix(tokenKey: string): string {
  return tokenKey.startsWith('_') ? tokenKey.slice(1) : tokenKey;
}

function buildAtoms(): Record<string, Atom> {
  const atoms: Record<string, Atom> = {};
  const add = (name: string, style: Atom) => {
    if (name in atoms) throw new Error(`design-atoms: duplicate atom ${name}`);
    atoms[name] = style;
  };

  /*
   * Layout
   */
  add('flex', { display: 'flex' });
  add('hidden', { display: 'none' });
  add('flex_1', { flex: 1 });
  add('flex_0', { flex: 0 });
  add('flex_row', { flexDirection: 'row' });
  add('flex_col', { flexDirection: 'column' });
  add('flex_row_reverse', { flexDirection: 'row-reverse' });
  add('flex_col_reverse', { flexDirection: 'column-reverse' });
  add('flex_wrap', { flexWrap: 'wrap' });
  add('flex_nowrap', { flexWrap: 'nowrap' });
  add('flex_grow', { flexGrow: 1 });
  add('flex_grow_0', { flexGrow: 0 });
  add('flex_shrink', { flexShrink: 1 });
  add('flex_shrink_0', { flexShrink: 0 });

  add('justify_start', { justifyContent: 'flex-start' });
  add('justify_center', { justifyContent: 'center' });
  add('justify_end', { justifyContent: 'flex-end' });
  add('justify_between', { justifyContent: 'space-between' });
  add('justify_around', { justifyContent: 'space-around' });
  add('justify_evenly', { justifyContent: 'space-evenly' });

  add('align_start', { alignItems: 'flex-start' });
  add('align_center', { alignItems: 'center' });
  add('align_end', { alignItems: 'flex-end' });
  add('align_stretch', { alignItems: 'stretch' });
  add('align_baseline', { alignItems: 'baseline' });

  add('self_auto', { alignSelf: 'auto' });
  add('self_start', { alignSelf: 'flex-start' });
  add('self_center', { alignSelf: 'center' });
  add('self_end', { alignSelf: 'flex-end' });
  add('self_stretch', { alignSelf: 'stretch' });
  add('self_baseline', { alignSelf: 'baseline' });

  add('content_start', { alignContent: 'flex-start' });
  add('content_center', { alignContent: 'center' });
  add('content_end', { alignContent: 'flex-end' });
  add('content_between', { alignContent: 'space-between' });
  add('content_stretch', { alignContent: 'stretch' });

  add('absolute', { position: 'absolute' });
  add('relative', { position: 'relative' });
  add('static', { position: 'static' });
  add('inset_0', { top: 0, right: 0, bottom: 0, left: 0 });
  add('top_0', { top: 0 });
  add('right_0', { right: 0 });
  add('bottom_0', { bottom: 0 });
  add('left_0', { left: 0 });
  for (const z of [0, 10, 20, 30, 40, 50]) add(`z_${z}`, { zIndex: z });

  add('overflow_hidden', { overflow: 'hidden' });
  add('overflow_visible', { overflow: 'visible' });
  add('overflow_scroll', { overflow: 'scroll' });

  add('w_full', { width: '100%' });
  add('h_full', { height: '100%' });
  add('max_w_full', { maxWidth: '100%' });
  add('max_h_full', { maxHeight: '100%' });
  add('aspect_square', { aspectRatio: 1 });

  add('pointer_events_none', { pointerEvents: 'none' });
  add('pointer_events_auto', { pointerEvents: 'auto' });
  add('pointer_events_box_only', { pointerEvents: 'box-only' });
  add('pointer_events_box_none', { pointerEvents: 'box-none' });

  add('bg_transparent', { backgroundColor: 'transparent' });
  add('opacity_0', { opacity: 0 });
  add('opacity_100', { opacity: 1 });

  /*
   * Spacing (D2: numeric suffixes)
   */
  const spacingProps: [string, string[]][] = [
    ['p', ['padding']],
    ['px', ['paddingLeft', 'paddingRight']],
    ['py', ['paddingTop', 'paddingBottom']],
    ['pt', ['paddingTop']],
    ['pb', ['paddingBottom']],
    ['pl', ['paddingLeft']],
    ['pr', ['paddingRight']],
    ['m', ['margin']],
    ['mx', ['marginLeft', 'marginRight']],
    ['my', ['marginTop', 'marginBottom']],
    ['mt', ['marginTop']],
    ['mb', ['marginBottom']],
    ['ml', ['marginLeft']],
    ['mr', ['marginRight']],
    ['gap', ['gap']],
    ['row_gap', ['rowGap']],
    ['column_gap', ['columnGap']],
  ];
  const negativeMarginProps = new Set(['m', 'mx', 'my', 'mt', 'mb', 'ml', 'mr']);
  for (const [prefix, props] of spacingProps) {
    for (const [key, value] of Object.entries(space)) {
      add(`${prefix}_${suffix(key)}`, Object.fromEntries(props.map(p => [p, value])));
    }
  }
  // Negative margins replace `Bleed` (P3): `a.mx_neg_20`.
  for (const [prefix, props] of spacingProps) {
    if (!negativeMarginProps.has(prefix)) continue;
    for (const [key, value] of Object.entries(space)) {
      if (value === 0) continue;
      add(`${prefix}_neg_${suffix(key)}`, Object.fromEntries(props.map(p => [p, -value])));
    }
  }
  add('m_auto', { margin: 'auto' });
  add('mx_auto', { marginLeft: 'auto', marginRight: 'auto' });
  add('my_auto', { marginTop: 'auto', marginBottom: 'auto' });
  add('mt_auto', { marginTop: 'auto' });
  add('mb_auto', { marginBottom: 'auto' });
  add('ml_auto', { marginLeft: 'auto' });
  add('mr_auto', { marginRight: 'auto' });

  /*
   * Borders
   */
  add('border_0', { borderWidth: 0 });
  add('border', { borderWidth: 1 });
  add('border_t', { borderTopWidth: 1 });
  add('border_b', { borderBottomWidth: 1 });
  add('border_l', { borderLeftWidth: 1 });
  add('border_r', { borderRightWidth: 1 });
  add('border_2', { borderWidth: 2 });
  add('curve_circular', { borderCurve: 'circular' });
  add('curve_continuous', { borderCurve: 'continuous' });
  for (const [key, value] of Object.entries(borderRadius)) {
    add(`rounded_${suffix(key)}`, { borderRadius: value });
  }

  /*
   * Typography. `text_N` carries the `typeHierarchy.text['Npt']` line height and
   * letter spacing so `normalizeTextStyles` finds its Capsize trim.
   */
  for (const [key, size] of Object.entries(fontSize)) {
    const entry = typeHierarchy.text[`${size}pt` as keyof typeof typeHierarchy.text];
    if (!entry) throw new Error(`design-atoms: no typeHierarchy.text['${size}pt'] entry for fontSize ${key}`);
    add(`text_${suffix(key)}`, { fontSize: entry.fontSize, letterSpacing: entry.letterSpacing, lineHeight: entry.lineHeight });
  }
  for (const [key, value] of Object.entries(lineHeight)) {
    add(`leading_${suffix(key)}`, { lineHeight: value });
  }
  add('tracking_0', { letterSpacing: 0 });
  for (const [key, value] of Object.entries(fontWeight)) {
    add(`font_${key}`, { fontWeight: value });
  }
  add('italic', { fontStyle: 'italic' });
  add('text_left', { textAlign: 'left' });
  add('text_center', { textAlign: 'center' });
  add('text_right', { textAlign: 'right' });
  add('uppercase', { textTransform: 'uppercase' });
  add('lowercase', { textTransform: 'lowercase' });
  add('capitalize', { textTransform: 'capitalize' });
  add('underline', { textDecorationLine: 'underline' });
  add('line_through', { textDecorationLine: 'line-through' });
  add('align_text_center', { textAlignVertical: 'center' });

  return atoms;
}

// fontVariant takes an array, so it is emitted separately.
const ARRAY_ATOMS: Record<string, Record<string, readonly string[]>> = {
  tabular_nums: { fontVariant: ['tabular-nums'] },
};

function literal(value: unknown): string {
  return JSON.stringify(value).replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, '$1:');
}

function renderAtoms(): string {
  const atoms = buildAtoms();
  const lines = Object.entries(atoms).map(([name, style]) => `  ${name}: ${literal(style)},`);
  for (const [name, style] of Object.entries(ARRAY_ATOMS)) lines.push(`  ${name}: ${literal(style)},`);
  return `${HEADER}

/**
 * Static style atoms. Order within a style array: layout, spacing, text, theme
 * atoms (\`t.atoms.*\`), then raw values.
 */
export const atoms = Object.freeze({
${lines.join('\n')}
} as const);

export type Atoms = typeof atoms;
`;
}

type CapsizeTableEntry = {
  fontSize: number;
  lineHeight: number;
  capHeightTrim: number;
  baselineTrim: number;
  marginCorrection: { ios: number; android: number };
};

function capsizeKey(size: number, leading: number, letterSpacing: number): string {
  return `${size}/${leading}/${letterSpacing}`;
}

type CapsizeTable = {
  /** One row per `typeHierarchy` entry, keyed by `group/name`. */
  entries: Record<string, CapsizeTableEntry>;
  /**
   * `fontSize/lineHeight/letterSpacing` -> entry key. When several entries share
   * the same metrics but differ in trim or margin correction, `text` entries win
   * over `heading` entries (in `typeHierarchy` order); the losers are listed in
   * `ambiguous` and are reachable only by their entry key.
   */
  index: Record<string, string>;
  ambiguous: Record<string, string[]>;
};

function buildCapsizeTable(): CapsizeTable {
  const entries: Record<string, CapsizeTableEntry> = {};
  const index: Record<string, string> = {};
  const ambiguous: Record<string, string[]> = {};
  const groups = ['text', 'heading'] as const;
  for (const group of groups) {
    for (const [name, entry] of Object.entries(typeHierarchy[group])) {
      const values = precomputeValues({ fontMetrics, fontSize: entry.fontSize, leading: entry.lineHeight });
      if (values.lineHeight === 'normal') throw new Error(`design-atoms: ${group}.${name} has no line height`);
      const row: CapsizeTableEntry = {
        fontSize: parseFloat(values.fontSize),
        lineHeight: parseFloat(values.lineHeight),
        capHeightTrim: parseFloat(values.capHeightTrim),
        baselineTrim: parseFloat(values.baselineTrim),
        marginCorrection: { ios: entry.marginCorrection.ios, android: entry.marginCorrection.android },
      };
      const entryKey = `${group}/${name}`;
      entries[entryKey] = row;
      const key = capsizeKey(entry.fontSize, entry.lineHeight, entry.letterSpacing);
      const winner = index[key];
      if (winner === undefined) {
        index[key] = entryKey;
      } else if (JSON.stringify(entries[winner]) !== JSON.stringify(row)) {
        (ambiguous[key] ??= []).push(entryKey);
      }
    }
  }
  return { entries, index, ambiguous };
}

function renderCapsizeTable(): string {
  const { entries, index, ambiguous } = buildCapsizeTable();
  const entryLines = Object.entries(entries).map(([key, row]) => `  ${JSON.stringify(key)}: ${literal(row)},`);
  const indexLines = Object.entries(index).map(([key, entryKey]) => `  '${key}': ${JSON.stringify(entryKey)},`);
  const ambiguousLines = Object.entries(ambiguous).map(([key, keys]) => `  '${key}': ${JSON.stringify(keys)},`);
  return `${HEADER}

/**
 * Capsize trims for every \`typeHierarchy\` entry. Trims are in em;
 * \`util/capsize.ts\` turns them into margins at runtime (font scale and pixel
 * rounding are device values).
 */
export type CapsizeTableEntry = {
  fontSize: number;
  lineHeight: number;
  capHeightTrim: number;
  baselineTrim: number;
  marginCorrection: { ios: number; android: number };
};

/** Keyed by \`<typeHierarchy group>/<entry name>\`. */
export const capsizeEntries: Readonly<Record<string, CapsizeTableEntry>> = Object.freeze({
${entryLines.join('\n')}
});

/**
 * \`fontSize/lineHeight/letterSpacing\` -> key in \`capsizeEntries\`. When metrics
 * collide, \`text\` entries win over \`heading\` entries.
 */
export const capsizeIndex: Readonly<Record<string, string>> = Object.freeze({
${indexLines.join('\n')}
});

/** Entries whose metrics collide with a \`capsizeIndex\` winner; look them up by entry key. */
export const capsizeAmbiguous: Readonly<Record<string, readonly string[]>> = Object.freeze({
${ambiguousLines.join('\n')}
});
`;
}

async function format(filepath: string, source: string): Promise<string> {
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(source, { ...options, filepath });
}

async function main() {
  const check = process.argv.includes('--check');
  const outputs: [string, string][] = [
    [ATOMS_FILE, await format(ATOMS_FILE, renderAtoms())],
    [CAPSIZE_FILE, await format(CAPSIZE_FILE, renderCapsizeTable())],
  ];

  let stale = 0;
  for (const [file, content] of outputs) {
    const rel = path.relative(ROOT, file);
    let current: string | null = null;
    try {
      current = readFileSync(file, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) {
      console.log(`design-atoms: ${rel} is up to date`);
      continue;
    }
    if (check) {
      console.error(`design-atoms: ${rel} is stale. Run \`bun run design:atoms\` and commit the result.`);
      stale += 1;
    } else {
      writeFileSync(file, content);
      console.log(`design-atoms: wrote ${rel}`);
    }
  }
  if (stale > 0) process.exit(1);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(2);
  });
}
