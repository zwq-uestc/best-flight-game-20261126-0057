// Dossier builder for this entry (Node 22, standard library only).
//
// buildDossier(dir, caps) reads dir/game/ and dir/screenshots/ and returns the
// makefun/dossier/v1 document as canonical JSON bytes: a "## Game" summary
// block, then every source file of game/ in the order the page loads them
// (index.html first, then its scripts in document order, then the rest by
// path), each fenced under a heading, the whole text capped at
// caps.text_max_bytes UTF-8 bytes, plus the screenshots as base64 images.
//
// The output is deterministic: the same directory always writes the same
// bytes. Caps beyond text_max_bytes only refuse oversized input.

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DOSSIER_SCHEMA = 'makefun/dossier/v1';
export const DOSSIER_MAX_BYTES = 4 * 1024 * 1024;
export const DOSSIER_MAX_IMAGES = 8;
export const INDEX_HTML = 'index.html';
export const INDEX_HTML_MAX_BYTES = 1024 * 1024;
export const GAME_PATH_MAX_BYTES = 1000;
const VENDORED_LISTED = 24;

export const SOURCE_EXTENSIONS = ['html', 'js', 'mjs', 'css', 'glsl', 'vert', 'frag', 'wgsl', 'json'] as const;
const GENERATED_NAME = /\.min\.(?:js|mjs|css)$/i;
const SOURCE_NAME = new RegExp(`\\.(?:${SOURCE_EXTENSIONS.join('|')})$`, 'i');
const MODULE_NAME = /\.(?:js|mjs)$/i;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

export type GameFileClass = 'source' | 'vendored' | 'asset';
export type DossierLimit = 'text_max_bytes' | 'screenshots.max' | 'screenshots.max_bytes' | 'game_max_files' | 'game_max_bytes' | 'game_path_max_bytes';

export class DossierError extends Error {
  readonly limit: DossierLimit | null;
  constructor(message: string, limit: DossierLimit | null = null) {
    super(message);
    this.name = 'DossierError';
    this.limit = limit;
  }
}

export interface GameCaps {
  game_max_files?: number;
  game_max_bytes?: number;
  game_path_max_bytes?: number;
}

export interface GameFile {
  path: string;
  bytes: number;
  cls: GameFileClass;
}

export interface GameTree {
  files: GameFile[];
  directories: string[];
  count: number;
  totalBytes: number;
}

export interface DossierCaps {
  text_max_bytes: number;
  screenshots?: { max: number; max_bytes: number };
  game_max_files?: number;
  game_max_bytes?: number;
  game_path_max_bytes?: number;
}

// ------------------------------------------------------------ small helpers

const decoder = new TextDecoder('utf-8');
const utf8Len = (s: string): number => Buffer.byteLength(s, 'utf8');
const decode = (b: Uint8Array): string => decoder.decode(b);
const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const digest = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const startsWithBytes = (b: Uint8Array, magic: readonly number[]): boolean =>
  b.length >= magic.length && magic.every((v, i) => b[i] === v);

function countLines(b: Uint8Array): number {
  if (b.length === 0) return 0;
  let n = 0;
  for (const byte of b) if (byte === 0x0a) n++;
  return b[b.length - 1] === 0x0a ? n : n + 1;
}

function fenceWidth(body: string): string {
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fenceLanguage(path: string): string {
  const ext = (/\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? '').toLowerCase();
  if (ext === 'js' || ext === 'mjs') return 'js';
  if (ext === 'glsl' || ext === 'vert' || ext === 'frag') return 'glsl';
  if (ext === 'wgsl' || ext === 'html' || ext === 'css' || ext === 'json') return ext;
  return 'text';
}

// ------------------------------------------------------------ canonical JSON

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: ${value} is not a finite number`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalJson: only plain objects and arrays');
    const rec = value as Record<string, unknown>;
    const parts = Object.keys(rec)
      .sort(codeUnit)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`);
    return `{${parts.join(',')}}`;
  }
  throw new TypeError(`canonicalJson: a ${typeof value} has no JSON form`);
}

// ------------------------------------------------------------ the game tree

export function classifyGamePath(path: string): GameFileClass {
  const segs = path.split('/');
  const base = segs[segs.length - 1] ?? '';
  if (segs.slice(0, -1).includes('vendor') || GENERATED_NAME.test(base)) return 'vendored';
  return SOURCE_NAME.test(base) ? 'source' : 'asset';
}

export function isSourcePath(path: string): boolean {
  return classifyGamePath(path) === 'source';
}

function checkedCaps(caps: GameCaps, who: string): Record<keyof GameCaps, number> {
  const out: Record<keyof GameCaps, number> = {
    game_max_files: Infinity,
    game_max_bytes: Infinity,
    game_path_max_bytes: GAME_PATH_MAX_BYTES,
  };
  for (const key of ['game_max_files', 'game_max_bytes', 'game_path_max_bytes'] as const) {
    const v = caps[key] as unknown;
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
      throw new TypeError(`${who}: caps.${key} must be a whole number, not ${String(v)}`);
    }
    out[key] = v;
  }
  return out;
}

export function readGameTree(gameDir: string, caps: GameCaps = {}): GameTree {
  const lim = checkedCaps(caps, 'readGameTree');
  let rootStat;
  try {
    rootStat = lstatSync(gameDir);
  } catch {
    throw new DossierError('game/: no such directory: a game is a directory of static files, its index.html at its root');
  }
  if (!rootStat.isDirectory()) throw new DossierError('game/: not a directory (a game is a directory of static files)');

  const files: GameFile[] = [];
  const directories: string[] = [];
  let count = 0;
  let totalBytes = 0;

  const walk = (rel: string): void => {
    let entries;
    try {
      entries = readdirSync(rel === '' ? gameDir : join(gameDir, rel), { withFileTypes: true });
    } catch (err) {
      throw new DossierError(`game/${rel === '' ? '' : `${rel}/`}: cannot be read (${(err as Error).message})`);
    }
    for (const entry of entries) {
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const pathBytes = utf8Len(path);
      if (pathBytes > lim.game_path_max_bytes) {
        throw new DossierError(`game/${path}: a path of ${pathBytes} bytes, over the ${lim.game_path_max_bytes} allowed (game_path_max_bytes)`, 'game_path_max_bytes');
      }
      let st;
      try {
        st = lstatSync(join(gameDir, path));
      } catch {
        throw new DossierError(`game/${path}: cannot be read`);
      }
      count++;
      if (count > lim.game_max_files) {
        throw new DossierError(`game/: holds more than the ${lim.game_max_files} files and directories allowed (game_max_files)`, 'game_max_files');
      }
      if (st.isDirectory()) {
        directories.push(path);
        walk(path);
      } else if (st.isFile()) {
        totalBytes += st.size;
        if (totalBytes > lim.game_max_bytes) {
          throw new DossierError(`game/: its files come to more than the ${lim.game_max_bytes} bytes allowed (game_max_bytes)`, 'game_max_bytes');
        }
        files.push({ path, bytes: st.size, cls: classifyGamePath(path) });
      } else {
        throw new DossierError(`game/${path}: a symbolic link or special file (game/ holds plain files and directories only)`);
      }
    }
  };
  walk('');
  files.sort((a, b) => codeUnit(a.path, b.path));
  directories.sort(codeUnit);
  return { files, directories, count, totalBytes };
}

function indexHtmlBytes(gameDir: string, tree: GameTree): Uint8Array {
  const file = tree.files.find((f) => f.path === INDEX_HTML);
  if (file === undefined) {
    if (tree.directories.includes(INDEX_HTML)) throw new DossierError('buildDossier: game/index.html: a directory, not the page');
    throw new DossierError('buildDossier: game/index.html: no such file: a game is a directory of static files, its index.html at its root');
  }
  if (file.bytes > INDEX_HTML_MAX_BYTES) {
    throw new DossierError(`buildDossier: game/index.html: ${file.bytes} bytes, over the ${INDEX_HTML_MAX_BYTES} a page may be`);
  }
  try {
    return new Uint8Array(readFileSync(join(gameDir, INDEX_HTML)));
  } catch (err) {
    throw new DossierError(`buildDossier: game/index.html: cannot be read (${(err as Error).message})`);
  }
}

// ------------------------------------------------------------ page scanning

export interface HtmlScript {
  src: string | null;
  type: string;
  text: string;
}

export interface HtmlLink {
  href: string;
  rel: string;
}

export interface HtmlResource {
  tag: string;
  src: string;
}

export interface HtmlImportMap {
  value: unknown;
  error: string | null;
}

export interface HtmlFacts {
  scripts: HtmlScript[];
  links: HtmlLink[];
  resources: HtmlResource[];
  importMaps: HtmlImportMap[];
}

const RESOURCE_TAGS = ['img', 'source', 'video', 'audio', 'iframe'] as const;

function endOfTag(html: string, from: number): number {
  let quote = '';
  for (let i = from; i < html.length; i++) {
    const ch = html[i]!;
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function parseAttributes(body: string): Map<string, string> {
  const attrs = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s/]/.test(body[i]!)) i++;
    if (i >= body.length) break;
    const nameStart = i;
    while (i < body.length && !/[\s=/>]/.test(body[i]!)) i++;
    const name = body.slice(nameStart, i).toLowerCase();
    while (i < body.length && /\s/.test(body[i]!)) i++;
    let value = '';
    if (body[i] === '=') {
      i++;
      while (i < body.length && /\s/.test(body[i]!)) i++;
      const quote = body[i];
      if (quote === '"' || quote === "'") {
        const end = body.indexOf(quote, i + 1);
        value = body.slice(i + 1, end < 0 ? body.length : end);
        i = end < 0 ? body.length : end + 1;
      } else {
        const valueStart = i;
        while (i < body.length && !/[\s>]/.test(body[i]!)) i++;
        value = body.slice(valueStart, i);
      }
    }
    if (name !== '') attrs.set(name, value);
  }
  return attrs;
}

function closingTagAt(html: string, from: number, name: string): number {
  const needle = `</${name}`;
  outer: for (let i = from; i + needle.length <= html.length; i++) {
    if (html[i] !== '<') continue;
    for (let j = 1; j < needle.length; j++) {
      if (html[i + j]!.toLowerCase() !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function htmlFacts(html: string): HtmlFacts {
  const scripts: HtmlScript[] = [];
  const links: HtmlLink[] = [];
  const resources: HtmlResource[] = [];
  const importMaps: HtmlImportMap[] = [];
  let i = 0;
  while (i < html.length) {
    const at = html.indexOf('<', i);
    if (at < 0) break;
    if (html.startsWith('<!--', at)) {
      const end = html.indexOf('-->', at + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', at)) {
      const end = html.indexOf('>', at + 2);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const peek = html.slice(at + 1, at + 8).toLowerCase();
    const boundary = (offset: number): boolean => !/[A-Za-z0-9]/.test(html[at + offset] ?? '');
    if (peek.startsWith('script') && boundary(7)) {
      const end = endOfTag(html, at + 7);
      if (end < 0) break;
      const attrs = parseAttributes(html.slice(at + 7, end));
      const type = (attrs.get('type') ?? '').trim().toLowerCase();
      const src = attrs.get('src') ?? null;
      const close = closingTagAt(html, end + 1, 'script');
      const body = src === null ? html.slice(end + 1, close < 0 ? html.length : close) : '';
      i = close < 0 ? html.length : close + 8;
      if (type === 'importmap') {
        let value: unknown = null;
        let error: string | null = null;
        try {
          value = JSON.parse(body);
        } catch (err) {
          error = (err as Error).message;
        }
        importMaps.push({ value, error });
      } else {
        scripts.push({ src, type, text: body });
      }
      continue;
    }
    if (peek.startsWith('link') && boundary(5)) {
      const end = endOfTag(html, at + 5);
      if (end < 0) break;
      const attrs = parseAttributes(html.slice(at + 5, end));
      const href = attrs.get('href');
      if (href !== undefined) links.push({ href, rel: (attrs.get('rel') ?? '').trim().toLowerCase() });
      i = end + 1;
      continue;
    }
    const tag = RESOURCE_TAGS.find((name) => peek.startsWith(name) && boundary(1 + name.length));
    if (tag !== undefined) {
      const end = endOfTag(html, at + 1 + tag.length);
      if (end < 0) break;
      const attrs = parseAttributes(html.slice(at + 1 + tag.length, end));
      const src = attrs.get('src');
      if (src !== undefined) resources.push({ tag, src });
      i = end + 1;
      continue;
    }
    const end = endOfTag(html, at + 1);
    i = end < 0 ? html.length : end + 1;
  }
  return { scripts, links, resources, importMaps };
}

// ------------------------------------------------------------ import maps

export interface ImportMap {
  imports: Record<string, string | null>;
  scopes: Record<string, Record<string, string | null>>;
}

export interface ImportMapRead {
  map: ImportMap | null;
  error: string | null;
}

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function setKey<T>(o: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
}

export function importMapOf(facts: HtmlFacts): ImportMapRead {
  if (facts.importMaps.length === 0) return { map: null, error: null };
  if (facts.importMaps.length > 1) {
    return { map: null, error: `index.html holds ${facts.importMaps.length} import maps: a page holds one at most` };
  }
  const only = facts.importMaps[0]!;
  if (only.error !== null) return { map: null, error: `index.html's import map is not JSON (${only.error})` };
  if (!isPlainRecord(only.value)) return { map: null, error: 'index.html\'s import map is not a JSON object' };
  const importsRaw = only.value.imports ?? {};
  if (!isPlainRecord(importsRaw)) return { map: null, error: 'index.html\'s import map holds an "imports" that is not an object' };
  const imports: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(importsRaw)) {
    if (value !== null && typeof value !== 'string') {
      return { map: null, error: `index.html's import map maps ${JSON.stringify(key)} to no string` };
    }
    setKey(imports, key, value);
  }
  const scopes: Record<string, Record<string, string | null>> = {};
  const scopesRaw = only.value.scopes;
  if (scopesRaw !== undefined) {
    if (!isPlainRecord(scopesRaw)) return { map: null, error: 'index.html\'s import map holds a "scopes" that is not an object' };
    for (const [scope, entries] of Object.entries(scopesRaw)) {
      if (!isPlainRecord(entries)) return { map: null, error: `index.html's import map scope ${JSON.stringify(scope)} is not an object` };
      const inner: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(entries)) {
        if (value !== null && typeof value !== 'string') {
          return { map: null, error: `index.html's import map scope ${JSON.stringify(scope)} maps ${JSON.stringify(key)} to no string` };
        }
        setKey(inner, key, value);
      }
      setKey(scopes, scope, inner);
    }
  }
  return { map: { imports, scopes }, error: null };
}

export function isRelativeRef(ref: string): boolean {
  return ref.length > 0 && !URI_SCHEME.test(ref) && !ref.startsWith('//') && !ref.startsWith('/');
}

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

export function resolveGamePath(ref: string, from: string): string | null {
  if (!isRelativeRef(ref)) return null;
  const cut = ref.search(/[?#]/);
  const raw = cut < 0 ? ref : ref.slice(0, cut);
  if (raw === '') return null;
  const parts = from.split('/').slice(0, -1);
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.length === 0 ? null : parts.join('/');
}

export interface ImportMapMatch {
  found: boolean;
  value: string | null;
}

function lookupIn(entries: Record<string, string | null>, specifier: string): ImportMapMatch {
  if (Object.hasOwn(entries, specifier)) return { found: true, value: entries[specifier]! };
  let bestKey: string | null = null;
  for (const key of Object.keys(entries)) {
    if (key.endsWith('/') && specifier.startsWith(key) && (bestKey === null || key.length > bestKey.length)) bestKey = key;
  }
  if (bestKey === null) return { found: false, value: null };
  const base = entries[bestKey]!;
  if (base === null) return { found: true, value: null };
  return { found: true, value: `${base}${specifier.slice(bestKey.length)}` };
}

function scopePrefix(scope: string): string | null {
  const cut = scope.search(/[?#]/);
  const raw = cut < 0 ? scope : scope.slice(0, cut);
  if (raw === '.' || raw === './') return '';
  return resolveGamePath(scope, INDEX_HTML);
}

export function importMapMatch(map: ImportMap | null, specifier: string, from: string = INDEX_HTML): ImportMapMatch {
  if (map === null) return { found: false, value: null };
  let chosen: { prefix: string; entries: Record<string, string | null> } | null = null;
  for (const [scope, entries] of Object.entries(map.scopes)) {
    const prefix = scopePrefix(scope);
    if (prefix === null || !from.startsWith(prefix)) continue;
    if (chosen === null || prefix.length > chosen.prefix.length) chosen = { prefix, entries };
  }
  if (chosen !== null) {
    const scoped = lookupIn(chosen.entries, specifier);
    if (scoped.found) return scoped;
  }
  return lookupIn(map.imports, specifier);
}

export function mappedSpecifier(map: ImportMap | null, specifier: string, from: string = INDEX_HTML): string | null {
  const match = importMapMatch(map, specifier, from);
  return match.found ? match.value : null;
}

function specifierPath(specifier: string, from: string, map: ImportMap | null): string | null {
  if (isRelativeSpecifier(specifier)) return resolveGamePath(specifier, from);
  const match = importMapMatch(map, specifier, from);
  if (!match.found || match.value === null || !isRelativeRef(match.value)) return null;
  return resolveGamePath(match.value, INDEX_HTML);
}

// ------------------------------------------------------------ static imports

const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_$]/;

export function sourceImports(source: string): string[] {
  const found: string[] = [];
  const n = source.length;
  let i = 0;
  let prev = '';

  const skipTrivia = (): void => {
    for (;;) {
      while (i < n && /\s/.test(source[i]!)) i++;
      if (source.startsWith('//', i)) {
        while (i < n && source[i] !== '\n') i++;
        continue;
      }
      if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      return;
    }
  };
  const readString = (quote: string): string | null => {
    i++;
    let s = '';
    while (i < n) {
      const ch = source[i]!;
      if (ch === quote) {
        i++;
        return s;
      }
      if (ch === '\\') {
        const next = source[i + 1];
        if (next === undefined) return null;
        s += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
        i += 2;
        continue;
      }
      if (ch === '\n') return null;
      s += ch;
      i++;
    }
    return null;
  };
  const skipTemplate = (): void => {
    i++;
    while (i < n) {
      const ch = source[i]!;
      if (ch === '\\') i += 2;
      else if (ch === '`') {
        i++;
        return;
      } else i++;
    }
  };
  const skipRegexLiteral = (): void => {
    i++;
    let inClass = false;
    while (i < n) {
      const ch = source[i]!;
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        i++;
        return;
      } else if (ch === '\n') return;
      i++;
    }
  };
  const readWord = (): string => {
    const start = i;
    while (i < n && IDENT_CHAR.test(source[i]!)) i++;
    return source.slice(start, i);
  };
  const stringHere = (): string | null => {
    skipTrivia();
    const ch = source[i];
    return ch === '"' || ch === "'" ? readString(ch) : null;
  };
  const clauseSpecifier = (stops: string[]): string | null => {
    for (;;) {
      skipTrivia();
      if (i >= n) return null;
      const ch = source[i]!;
      if (stops.includes(ch)) return null;
      if (ch === '"' || ch === "'") return readString(ch);
      if (ch === '{' || ch === '}' || ch === ',' || ch === '*') {
        i++;
        continue;
      }
      if (IDENT_START.test(ch)) {
        const word = readWord();
        if (word === 'from') return stringHere();
        continue;
      }
      return null;
    }
  };

  while (i < n) {
    skipTrivia();
    if (i >= n) break;
    const ch = source[i]!;
    if (ch === '"' || ch === "'") {
      readString(ch);
      prev = ch;
      continue;
    }
    if (ch === '`') {
      skipTemplate();
      prev = '`';
      continue;
    }
    if (ch === '/') {
      if (prev === '' || '([{,;:=!&|?+-*%^~<>'.includes(prev)) skipRegexLiteral();
      else i++;
      prev = '/';
      continue;
    }
    if (IDENT_START.test(ch)) {
      const word = readWord();
      prev = 'a';
      if (word === 'import') {
        skipTrivia();
        if (source[i] === '(' || source[i] === '.') continue;
        const spec = clauseSpecifier(['=', ';']);
        if (spec !== null) found.push(spec);
        continue;
      }
      if (word === 'export') {
        skipTrivia();
        if (source[i] !== '*' && source[i] !== '{') continue;
        const spec = clauseSpecifier(['=', ';']);
        if (spec !== null) found.push(spec);
        continue;
      }
      continue;
    }
    prev = ch;
    i++;
  }
  return found;
}

export interface GameSource {
  path: string;
  bytes: Uint8Array;
}

const CLASSIC_SCRIPT_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

function isClassicType(type: string): boolean {
  return type === '' || CLASSIC_SCRIPT_TYPES.has(type.split(';')[0]!.trim());
}

export function importOrder(sources: readonly GameSource[], facts: HtmlFacts): string[] {
  const byPath = new Map(sources.map((s) => [s.path, s]));
  const map = importMapOf(facts).map;
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (path: string, walk = true): void => {
    if (seen.has(path) || !MODULE_NAME.test(path) || !byPath.has(path)) return;
    seen.add(path);
    order.push(path);
    if (!walk) return;
    for (const specifier of sourceImports(decode(byPath.get(path)!.bytes))) {
      const target = specifierPath(specifier, path, map);
      if (target !== null) visit(target);
    }
  };
  for (const script of facts.scripts) {
    if (script.type !== 'module') {
      if (isClassicType(script.type) && script.src !== null && isRelativeRef(script.src)) {
        const target = resolveGamePath(script.src, INDEX_HTML);
        if (target !== null) visit(target, false);
      }
      continue;
    }
    if (script.src !== null) {
      const target = isRelativeRef(script.src)
        ? resolveGamePath(script.src, INDEX_HTML)
        : specifierPath(script.src, INDEX_HTML, map);
      if (target !== null) visit(target);
    } else {
      for (const specifier of sourceImports(script.text)) {
        const target = specifierPath(specifier, INDEX_HTML, map);
        if (target !== null) visit(target);
      }
    }
  }
  return order;
}

// ------------------------------------------------------------ the dossier

function extensionGroup(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '(none)';
}

function gameSummaryLines(tree: GameTree): string[] {
  const byClass = (cls: GameFileClass): GameFile[] => tree.files.filter((f) => f.cls === cls);
  const total = (list: readonly GameFile[]): number => list.reduce((n, f) => n + f.bytes, 0);
  const source = byClass('source');
  const vendored = byClass('vendored');
  const assets = byClass('asset');
  const lines = [
    '## Game',
    '',
    `Source files: ${source.length} (${total(source)} bytes)`,
    `Vendored files: ${vendored.length} (${total(vendored)} bytes)`,
  ];
  if (vendored.length > 0) {
    const listed = vendored.slice(0, VENDORED_LISTED).map((f) => `game/${f.path} (${f.bytes} bytes)`);
    const more = vendored.length > VENDORED_LISTED ? `, and ${vendored.length - VENDORED_LISTED} more` : '';
    lines.push(`  ${listed.join(', ')}${more}`);
  }
  const byExt = new Map<string, { n: number; bytes: number }>();
  for (const f of assets) {
    const ext = extensionGroup(f.path);
    const at = byExt.get(ext) ?? { n: 0, bytes: 0 };
    at.n++;
    at.bytes += f.bytes;
    byExt.set(ext, at);
  }
  const extText = [...byExt]
    .sort((a, b) => codeUnit(a[0], b[0]))
    .map(([ext, at]) => `${ext} ${at.n} (${at.bytes} bytes)`)
    .join(', ');
  lines.push(`Assets: ${extText === '' ? 'none' : extText}`);
  lines.push(`Totals: ${tree.count} files and directories (${tree.totalBytes} bytes)`);
  return lines;
}

interface PreparedSource {
  raw: Uint8Array;
  text: string;
  fence: string;
  block: string;
  blockBytes: number;
  lines: number;
}

function partialSection(
  heading: string,
  code: { raw: Uint8Array; text: string; fence: string },
  language: string,
  room: number,
  tail: (hidden: number) => string,
): string | null {
  const total = countLines(code.raw);
  const lines = code.text.split('\n');
  const open = `${code.fence}${language}\n`;
  const close = `${code.fence}\n\n`;
  const note = (k: number): string => `[${total - k} of this file's ${total} lines not shown.]\n`;
  const fixed = utf8Len(heading) + utf8Len(open) + utf8Len(close);
  let best = 0;
  let shown = 0;
  let rawPos = 0;
  for (let k = 1; k < total; k++) {
    shown += utf8Len(lines[k - 1]!) + 1;
    rawPos = code.raw.indexOf(0x0a, rawPos) + 1;
    if (fixed + shown + utf8Len(note(k)) + utf8Len(tail(code.raw.length - rawPos)) <= room) best = k;
  }
  if (best === 0) return null;
  let rawEnd = 0;
  for (let k = 0; k < best; k++) rawEnd = code.raw.indexOf(0x0a, rawEnd) + 1;
  const head = lines.slice(0, best).map((l) => `${l}\n`).join('');
  return `${heading}${open}${head}${close}${note(best)}${tail(code.raw.length - rawEnd)}`;
}

export function buildDossier(dir: string, caps: DossierCaps): Uint8Array {
  const max = caps.text_max_bytes;
  if (!Number.isSafeInteger(max) || max <= 0) {
    throw new DossierError(`buildDossier: caps.text_max_bytes must be a positive integer, not ${String(max)}`, 'text_max_bytes');
  }
  let maxImages = { n: DOSSIER_MAX_IMAGES, whose: 'a dossier holds' };
  let maxImageBytes = { n: DOSSIER_MAX_BYTES, whose: 'a dossier holds' };
  if (caps.screenshots !== undefined) {
    const s = caps.screenshots as { max?: unknown; max_bytes?: unknown } | null;
    if (typeof s !== 'object' || s === null) throw new DossierError('buildDossier: caps.screenshots must be an object {max, max_bytes}');
    for (const k of ['max', 'max_bytes'] as const) {
      const v = s[k];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
        throw new DossierError(`buildDossier: caps.screenshots.${k} must be a positive integer, not ${String(v)}`, `screenshots.${k}`);
      }
    }
    if ((s.max as number) < maxImages.n) maxImages = { n: s.max as number, whose: 'caps.screenshots.max allows' };
    if ((s.max_bytes as number) < maxImageBytes.n) maxImageBytes = { n: s.max_bytes as number, whose: 'caps.screenshots.max_bytes allows' };
  }
  const gameCaps: GameCaps = {};
  for (const k of ['game_max_files', 'game_max_bytes', 'game_path_max_bytes'] as const) {
    const v = caps[k] as unknown;
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
      throw new DossierError(`buildDossier: caps.${k} must be a whole number, not ${String(v)}`, k);
    }
    gameCaps[k] = v;
  }

  const gameDir = join(dir, 'game');
  const tree = readGameTree(gameDir, gameCaps);
  const facts = htmlFacts(decode(indexHtmlBytes(gameDir, tree)));

  const sources = tree.files
    .filter((f) => f.cls === 'source')
    .map((f) => ({ path: f.path, bytes: new Uint8Array(readFileSync(join(gameDir, f.path))) }));
  const sourceByPath = new Map(sources.map((s) => [s.path, s]));
  const ordered = importOrder(sources, facts).filter((p) => p !== INDEX_HTML);
  const placed = new Set<string>([INDEX_HTML, ...ordered]);
  const rest = sources.map((s) => s.path).filter((p) => !placed.has(p)).sort(codeUnit);
  const order = [INDEX_HTML, ...ordered, ...rest];

  const prepared = new Map<string, PreparedSource>();
  const prepare = (path: string): PreparedSource | null => {
    const cached = prepared.get(path);
    if (cached !== undefined) return cached;
    const file = sourceByPath.get(path);
    if (file === undefined) return null;
    const t = decode(file.bytes);
    const fence = fenceWidth(t);
    const block = `${fence}${fenceLanguage(path)}\n${t}${t.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    const made: PreparedSource = {
      raw: file.bytes,
      text: t,
      fence,
      block,
      blockBytes: utf8Len(block),
      lines: countLines(file.bytes),
    };
    prepared.set(path, made);
    return made;
  };

  const shotNames = ((): string[] => {
    const shotsDir = join(dir, 'screenshots');
    let stat;
    try {
      stat = lstatSync(shotsDir);
    } catch {
      throw new DossierError('buildDossier: no screenshots/ directory: an entry hands in 3 or 4 renders of its game, the first by name the cover');
    }
    if (!stat.isDirectory()) {
      throw new DossierError('buildDossier: screenshots is not a directory: an entry hands in 3 or 4 renders of its game, the first by name the cover');
    }
    try {
      return readdirSync(shotsDir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort(codeUnit);
    } catch (err) {
      throw new DossierError(`buildDossier: screenshots/ cannot be read (${(err as Error).message})`);
    }
  })();
  if (shotNames.length === 0) throw new DossierError('buildDossier: screenshots/ holds no image: the first is the cover');
  if (shotNames.length > maxImages.n) {
    throw new DossierError(`buildDossier: screenshots/ holds ${shotNames.length} files, over the ${maxImages.n} ${maxImages.whose}`, 'screenshots.max');
  }
  const images = shotNames.map((name) => {
    if (!IMAGE_NAME.test(name)) {
      throw new DossierError(`buildDossier: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
    }
    const size = lstatSync(join(dir, 'screenshots', name)).size;
    if (size > maxImageBytes.n) {
      throw new DossierError(`buildDossier: screenshots/${name} is ${size} bytes, over the ${maxImageBytes.n} ${maxImageBytes.whose}`, 'screenshots.max_bytes');
    }
    const bytes = new Uint8Array(readFileSync(join(dir, 'screenshots', name)));
    if (bytes.length > maxImageBytes.n) {
      throw new DossierError(`buildDossier: screenshots/${name} is ${bytes.length} bytes, over the ${maxImageBytes.n} ${maxImageBytes.whose}`, 'screenshots.max_bytes');
    }
    const media_type = startsWithBytes(bytes, PNG_MAGIC) ? 'image/png' : startsWithBytes(bytes, JPEG_MAGIC) ? 'image/jpeg' : null;
    if (media_type === null) throw new DossierError(`buildDossier: screenshots/${name} is neither a PNG nor a JPEG`);
    return { name, media_type, sha256: digest(bytes), base64: Buffer.from(bytes).toString('base64') };
  });

  const head = [...gameSummaryLines(tree), '', '## Sources', '', ''].join('\n');
  const sections = order.map((path) => {
    const code = prepare(path);
    const lines = code === null ? 0 : code.lines;
    const bytes = code === null ? 0 : code.raw.length;
    const heading = `### game/${path} (${lines} ${lines === 1 ? 'line' : 'lines'}, ${bytes} bytes)\n\n`;
    const shown = lines === 0 ? null : code;
    return { heading, code: shown, size: utf8Len(heading) + (shown === null ? 0 : shown.blockBytes), bytes };
  });
  const restBytes = new Array<number>(sections.length + 1).fill(0);
  for (let k = sections.length - 1; k >= 0; k--) {
    restBytes[k] = restBytes[k + 1]! + (k + 1 < sections.length ? sections[k + 1]!.bytes : 0);
  }

  const cutLine = (files: number, bytes: number): string =>
    `[Cut at ${max} bytes: ${files} file${files === 1 ? '' : 's'} and ${bytes} bytes of source left out.]\n`;
  let out = head;
  let used = utf8Len(head);
  let kept = 0;
  for (; kept < sections.length; kept++) {
    const section = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const tail = restCount === 0 ? 0 : utf8Len(cutLine(restCount, restBytes[kept]!));
    if (used + section.size + tail > max) break;
    out += section.code === null ? section.heading : `${section.heading}${section.code.block}`;
    used += section.size;
  }
  if (kept < sections.length) {
    const first = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const after = restBytes[kept]!;
    const part = first.code === null
      ? null
      : partialSection(first.heading, first.code, fenceLanguage(order[kept]!), max - used, (hidden) => cutLine(restCount, after + hidden));
    out += part ?? cutLine(restCount + 1, after + first.bytes);
  }
  if (utf8Len(out) > max) {
    throw new DossierError(`buildDossier: caps.text_max_bytes ${max} cannot hold even the Game block and the cut line`, 'text_max_bytes');
  }

  const doc = { schema: DOSSIER_SCHEMA, cover: 0, text: out.replace(/\n+$/, '\n'), images };
  const bytes = Buffer.from(canonicalJson(doc), 'utf8');
  if (bytes.length > DOSSIER_MAX_BYTES) {
    throw new DossierError(`buildDossier: the dossier is ${bytes.length} bytes, over the ${DOSSIER_MAX_BYTES} one holds`);
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}
