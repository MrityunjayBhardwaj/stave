"use client";

/**
 * Asset Library shell (#819) — the reusable browser that houses every asset
 * type. It knows nothing sound- or viz-specific: it enumerates the registered
 * {@link AssetProvider}s, applies the search + type + source filters, and
 * renders a windowed list of provider-supplied {@link Asset}s. Each row exposes
 * two uniform action slots — a primary preview (play/stop) and a hover insert —
 * plus a hover Copy (#823) — that just drive `asset.preview()` / `asset.insert()`
 * and copy `asset.id`.
 *
 * The concrete Sounds provider (#820) is the first real provider; the shell stays
 * type-agnostic so the viz/snippet providers register the same way.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import {
  AddAudioButton,
  AddAudioMessage,
  useAudioDrop,
  useAudioImport,
} from "./AddAudioButton";
import { RecordTakeButton } from "./RecordTakeButton";
import {
  listAssetProviders,
  subscribeToAssetProviders,
} from "./registry";
import {
  availableCategories,
  availableSources,
  availableTypes,
  collectAssets,
  type AssetFilter,
} from "./filter";
import { computeWindow } from "./windowing";
import { useVizPreviewHeight } from "../state/vizPreviewHeight";
import type { Asset, AssetPreviewHandle, AssetSource, AssetType } from "./types";

const ROW_HEIGHT = 40;
/** Types shown as a wrapping CARD GRID (aspect-true thumbnail + name beneath)
 *  rather than the compact windowed icon-list. A card view is always a single
 *  type (the Type filter isolates it) and small (a curated shelf), so it renders
 *  every card in a flex grid — no windowing. */
const CARD_TYPES = new Set<AssetType>(["viz"]);
/** Extra rows rendered above/below the viewport so fast scrolls don't flash. */
const OVERSCAN = 6;
/** How long the copy button shows its "copied" check before reverting. */
const COPIED_MS = 1200;

/** Copy text to the clipboard — async Clipboard API with an execCommand
 *  fallback for non-secure contexts. Resolves true on success. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const TYPE_LABELS: Record<AssetType, string> = {
  sound: "Sounds",
  viz: "Viz",
  snippet: "Snippets",
  sample: "Samples",
};
const SOURCE_LABELS: Record<AssetSource, string> = {
  "built-in": "Built-in",
  user: "User",
  community: "Community",
};

export function AssetLibraryPanel({ onClose }: { onClose?: () => void }) {
  // Re-render on any provider registration / catalog change.
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeToAssetProviders(() => setTick((t) => t + 1)), []);
  const providers = useMemo(() => listAssetProviders(), [tick]);

  // #1541 — one owner for both ways audio arrives: the picker and a drop
  // anywhere on the panel.
  const audio = useAudioImport();
  const onFiles = useCallback(
    (files: readonly File[]) => void audio.importFiles(files),
    [audio],
  );
  const drop = useAudioDrop(onFiles);

  const [query, setQuery] = useState("");
  const [type, setType] = useState<AssetType | null>(null);
  const [source, setSource] = useState<AssetSource | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  const filter: AssetFilter = useMemo(
    () => ({ query, type, source, category }),
    [query, type, source, category],
  );
  const assets = useMemo(
    () => collectAssets(providers, filter),
    [providers, filter],
  );

  const types = useMemo(() => availableTypes(providers), [providers]);
  const sources = useMemo(() => availableSources(providers), [providers]);
  // Category counts are scoped to the active type/source (so they match "All")
  // but ignore the query/category, so the numbers stay put while browsing.
  const categories = useMemo(
    () => availableCategories(providers, { type, source }),
    [providers, type, source],
  );
  const total = useMemo(
    () => categories.reduce((n, c) => n + c.count, 0),
    [categories],
  );
  const loading = providers.some((p) => p.isLoading?.() ?? false);

  // Default to the FIRST available type instead of the noisy "All" union once
  // more than one type exists. Sounds outnumber viz ~1851:12, so "All" buries
  // viz at the end and mixes two category taxonomies in one belt; landing on a
  // type shows one clean taxonomy. Fires ONCE (a ref guard) so the user can pick
  // "All" afterward without it snapping back. (#832)
  const didInitType = useRef(false);
  useEffect(() => {
    if (didInitType.current) return;
    if (types.length > 1) {
      didInitType.current = true;
      setType(types[0]);
    }
  }, [types]);

  // A type/source chip that filters to a value no longer present would strand
  // the list empty with no way back — drop the filter if its value vanished.
  // For `type`, fall back to another available type (not "All") to keep the
  // default-to-type policy; only null when a single type remains (the Type row
  // hides then and "All" == that lone type anyway).
  useEffect(() => {
    if (type && !types.includes(type)) setType(types.length > 1 ? types[0] : null);
  }, [type, types]);
  useEffect(() => {
    if (source && !sources.includes(source)) setSource(null);
  }, [source, sources]);
  useEffect(() => {
    if (category && !categories.some((c) => c.category === category)) setCategory(null);
  }, [category, categories]);

  // ---- Single-active-preview: starting a row stops the previous one. --------
  const activePreview = useRef<{ key: string; handle: AssetPreviewHandle | null } | null>(null);
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);

  const stopPreview = useCallback(() => {
    activePreview.current?.handle?.stop();
    activePreview.current = null;
    setPreviewingKey(null);
  }, []);

  // Stop any preview when the panel unmounts (closed / project switch).
  useEffect(() => stopPreview, [stopPreview]);

  const togglePreview = useCallback(
    async (key: string, asset: Asset) => {
      if (!asset.preview) return;
      if (previewingKey === key) {
        stopPreview();
        return;
      }
      stopPreview();
      setPreviewingKey(key);
      // Mark this the active request BEFORE awaiting so a slower earlier start
      // can't clobber a newer one.
      const token = { key, handle: null as AssetPreviewHandle | null };
      activePreview.current = token;
      try {
        const handle = await asset.preview();
        if (activePreview.current !== token) {
          // A newer preview started (or stop fired) while we awaited — cancel.
          handle?.stop();
          return;
        }
        token.handle = handle ?? null;
        // Fire-and-forget previews (void handle) clear the "playing" badge
        // immediately; sustained ones keep it until stop.
        if (!handle) setPreviewingKey((cur) => (cur === key ? null : cur));
      } catch {
        if (activePreview.current === token) stopPreview();
      }
    },
    [previewingKey, stopPreview],
  );

  return (
    <div
      style={{ ...styles.root, ...(drop.over ? styles.dropping : null) }}
      data-sidebar
      data-asset-library
      data-audio-dropping={drop.over ? "true" : "false"}
      {...drop.handlers}
    >
      <div style={styles.header}>
        <span>LIBRARY</span>
        <div style={styles.headerActions}>
          {/* #1504/#1541 — the two ways audio gets in sit with what they
              produce. Add comes first: it is the one every project can use,
              while recording needs a microphone and a permission. */}
          <AddAudioButton busy={audio.busy} onFiles={onFiles} />
          <RecordTakeButton />
          {onClose && (
            <button
              style={styles.headerClose}
              title="Close"
              aria-label="Close Library"
              onClick={onClose}
            >
              <Icon name="chevron-left" size="14px" />
            </button>
          )}
        </div>
      </div>

      <AddAudioMessage message={audio.message} />

      <div style={styles.controls}>
        <input
          style={styles.search}
          placeholder="Search assets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-asset-search
          aria-label="Search assets"
        />
        {types.length > 1 && (
          <ChipRow
            label="Type"
            active={type}
            values={types}
            render={(t) => TYPE_LABELS[t]}
            onPick={(t) => setType(t)}
            dataAttr="asset-type-filter"
          />
        )}
        {categories.length > 1 && (
          <CategoryChips
            active={category}
            total={total}
            categories={categories}
            onPick={setCategory}
          />
        )}
        {sources.length > 1 && (
          <ChipRow
            label="Source"
            active={source}
            values={sources}
            render={(s) => SOURCE_LABELS[s]}
            onPick={(s) => setSource(s)}
            dataAttr="asset-source-filter"
          />
        )}
      </div>

      <AssetList
        assets={assets}
        loading={loading}
        // Viz-type view renders as cards (aspect-true thumbnail + name below).
        // Only when a single card-type is active, so the list stays uniform.
        card={type != null && CARD_TYPES.has(type)}
        previewingKey={previewingKey}
        onTogglePreview={togglePreview}
        // Reset scroll to top when the FILTER changes (not when the catalog
        // grows under a stable filter) — a new search starts at the top, but
        // browsing position survives a lazily-growing provider.
        resetKey={`${type ?? ""}|${source ?? ""}|${category ?? ""}|${query}`}
      />
    </div>
  );
}

/** A labelled row of mutually-exclusive filter chips ("All" + each value). */
function ChipRow<T extends string>({
  label,
  active,
  values,
  render,
  onPick,
  dataAttr,
}: {
  label: string;
  active: T | null;
  values: readonly T[];
  render: (v: T) => string;
  onPick: (v: T | null) => void;
  dataAttr: string;
}) {
  return (
    <div style={styles.chipRow} data-filter={dataAttr} aria-label={`${label} filter`}>
      <button
        style={{ ...styles.chip, ...(active === null ? styles.chipActive : {}) }}
        onClick={() => onPick(null)}
        aria-pressed={active === null}
        data-chip="all"
      >
        All
      </button>
      {values.map((v) => (
        <button
          key={v}
          style={{ ...styles.chip, ...(active === v ? styles.chipActive : {}) }}
          onClick={() => onPick(active === v ? null : v)}
          aria-pressed={active === v}
          data-chip={v}
        >
          {render(v)}
        </button>
      ))}
    </div>
  );
}

/** Category filter chips with entry counts: `All <total>` + one per category
 *  (`Drums 1357`, `Soundfonts 125`, …). Picking narrows the list to that
 *  category; clicking the active one (or All) clears it. Wraps to fit the
 *  compact sidebar (the shared chipRow style). */
function CategoryChips({
  active,
  total,
  categories,
  onPick,
}: {
  active: string | null;
  total: number;
  categories: { category: string; count: number }[];
  onPick: (c: string | null) => void;
}) {
  return (
    <div style={styles.categoryChipRow} data-filter="asset-category-filter" aria-label="Category filter">
      <button
        style={{ ...styles.chip, ...(active === null ? styles.chipActive : {}) }}
        onClick={() => onPick(null)}
        aria-pressed={active === null}
        data-chip="all"
      >
        All <span style={styles.chipCount}>{total}</span>
      </button>
      {categories.map(({ category, count }) => (
        <button
          key={category}
          style={{ ...styles.chip, ...(active === category ? styles.chipActive : {}) }}
          onClick={() => onPick(active === category ? null : category)}
          aria-pressed={active === category}
          data-chip={category}
        >
          {category} <span style={styles.chipCount}>{count}</span>
        </button>
      ))}
    </div>
  );
}

/** Windowed list — renders only the rows in view (+overscan). The sound catalog
 *  is ~1800 rows, so full rendering would jank; a fixed row height lets us map
 *  scrollTop → visible slice without measuring. */
function AssetList({
  assets,
  loading,
  card,
  previewingKey,
  onTogglePreview,
  resetKey,
}: {
  assets: Asset[];
  loading: boolean;
  card: boolean;
  previewingKey: string | null;
  onTogglePreview: (key: string, asset: Asset) => void;
  resetKey: string;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  // Callback ref, NOT a mount effect: the scroll node only exists once the
  // catalog is non-empty, so a one-shot `[]` effect that reads scrollRef at
  // first mount misses the loading→loaded transition (the node is null then
  // and the effect never re-runs). A stable callback ref fires on every
  // attach/detach, so the observer wires up whenever the list actually renders
  // — including after a lazy provider (sounds) warms up. (F1)
  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    nodeRef.current = el;
    if (!el) return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  // Reset scroll when the filter changes so a new search starts at the top and
  // a stale scrollTop can't point past the (now shorter) content. (F2)
  useEffect(() => {
    if (nodeRef.current) nodeRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  const total = assets.length;
  if (loading && total === 0) {
    return (
      <div style={styles.listEmpty} data-asset-list data-state="loading">
        Loading assets…
      </div>
    );
  }
  if (total === 0) {
    return (
      <div style={styles.listEmpty} data-asset-list data-state="empty">
        No assets match.
      </div>
    );
  }

  // Card view (viz): a small curated corpus, so render a wrapping flex grid —
  // no windowing (the Type filter isolates one type, so this is only cards, and
  // there are only a handful). Cards are sized by the shader's aspect at the
  // settings-controlled height, so the grid reflows (fewer columns as they grow).
  if (card) {
    return (
      <CardGrid
        assets={assets}
        previewingKey={previewingKey}
        onTogglePreview={onTogglePreview}
        total={total}
      />
    );
  }

  // Compact windowed list (sounds + mixed "All"): fixed-height rows, only the
  // visible slice rendered. `computeWindow` clamps `first` so a stale
  // scrollTop after the list shrinks can't yield an empty slice → blank. (F2)
  const { first, last } = computeWindow(total, scrollTop, viewportH, ROW_HEIGHT, OVERSCAN);
  const slice = assets.slice(first, last);
  return (
    <div
      ref={setScrollEl}
      style={styles.listScroll}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      data-asset-list
      data-count={String(total)}
    >
      <div style={{ height: total * ROW_HEIGHT, position: "relative" }}>
        {slice.map((asset, i) => {
          const index = first + i;
          const key = `${asset.type}:${asset.id}`;
          return (
            <AssetRow
              key={key}
              asset={asset}
              rowKey={key}
              top={index * ROW_HEIGHT}
              previewing={previewingKey === key}
              onTogglePreview={onTogglePreview}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Shared per-item state + the three hover action slots (copy / add / preview),
 *  used by both the compact `AssetRow` and the grid `AssetCard`. `btn` styles
 *  the icons so the card can use lighter ones over its dark overlay. */
function useRowActions(
  asset: Asset,
  rowKey: string,
  previewing: boolean,
  onTogglePreview: (key: string, asset: Asset) => void,
) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // What Copy puts on the clipboard: the asset's code token (the string you'd
  // type in code). Sounds leave `code` unset → the id; viz sets it to the preset
  // name (`.viz("name")` resolves by name, not the unique row id).
  const codeToken = asset.code ?? asset.id;
  const handleCopy = useCallback(() => {
    void copyToClipboard(codeToken).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  }, [codeToken]);

  const actions = (btn: React.CSSProperties) => (
    <>
      {/* Copy the code token — hover-revealed; brief check on success. */}
      {(hovered || previewing || copied) && (
        <button
          style={{ ...btn, ...(copied ? styles.rowBtnActive : {}) }}
          title={copied ? "Copied!" : `Copy "${codeToken}"`}
          aria-label={`Copy name ${codeToken}`}
          onClick={handleCopy}
          data-asset-copy={rowKey}
        >
          <Icon name={copied ? "check" : "copy"} size="14px" />
        </button>
      )}
      {/* Insert / add — hover-revealed. */}
      {asset.insert && (hovered || previewing) && (
        <button
          style={btn}
          title={asset.insertLabel ?? "Insert into code"}
          aria-label={`${asset.insertLabel ?? "Insert"} ${asset.name}`}
          onClick={() => asset.insert?.()}
          data-asset-insert={rowKey}
        >
          <Icon name="add" size="14px" />
        </button>
      )}
      {/* Preview — play toggles to stop while active. */}
      {asset.preview && (
        <button
          style={{ ...btn, ...(previewing ? styles.rowBtnActive : {}) }}
          title={previewing ? "Stop" : "Preview"}
          aria-label={previewing ? `Stop ${asset.name}` : `Preview ${asset.name}`}
          onClick={() => onTogglePreview(rowKey, asset)}
          data-asset-preview={rowKey}
        >
          <Icon name={previewing ? "debug-stop" : "play"} size="14px" />
        </button>
      )}
    </>
  );

  const hoverProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };
  return { hovered, copied, previewing, actions, hoverProps };
}

/** Compact icon-row — absolute-positioned in the windowed list (sounds; viz
 *  under the mixed "All" view). */
function AssetRow({
  asset,
  rowKey,
  top,
  previewing,
  onTogglePreview,
}: {
  asset: Asset;
  rowKey: string;
  top: number;
  previewing: boolean;
  onTogglePreview: (key: string, asset: Asset) => void;
}) {
  const { actions, hoverProps } = useRowActions(asset, rowKey, previewing, onTogglePreview);
  return (
    <div style={{ ...styles.row, top }} {...hoverProps} data-asset-row={rowKey}>
      {/* Leading thumbnail — present for visual assets (viz packages ship a
          baked frame, else a renderer-hued placeholder); sounds leave it unset. */}
      {asset.thumbnail && (
        <img src={asset.thumbnail} alt="" style={styles.rowThumb} data-asset-thumb={rowKey} />
      )}
      <div style={styles.rowText}>
        <span style={styles.rowName}>{asset.name}</span>
        {asset.group && <span style={styles.rowGroup}>{asset.group}</span>}
      </div>
      <div style={styles.rowActions}>{actions(styles.rowBtn)}</div>
    </div>
  );
}

/** The viz card grid. Cards are sized by each shader's aspect at the settings
 *  height, so this measures its own content width — a card is capped to one
 *  column (a wide 2:1 shader at a tall height would otherwise overflow the
 *  narrow sidebar) — and the flex row reflows: more columns when cards are
 *  small, fewer as they grow. */
function CardGrid({
  assets,
  previewingKey,
  onTogglePreview,
  total,
}: {
  assets: Asset[];
  previewingKey: string | null;
  onTogglePreview: (key: string, asset: Asset) => void;
  total: number;
}) {
  const [maxCardW, setMaxCardW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  // Callback ref + ResizeObserver (same pattern as the windowed list): measure
  // the grid's CONTENT width (client minus padding) on attach and on any panel
  // resize, so each card can cap its width to one column.
  const setGridEl = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      setMaxCardW(Math.max(0, el.clientWidth - pad));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  return (
    <div style={styles.gridScroll} data-asset-list data-count={String(total)}>
      <div ref={setGridEl} style={styles.cardGrid}>
        {assets.map((asset) => {
          const key = `${asset.type}:${asset.id}`;
          return (
            <AssetCard
              key={key}
              asset={asset}
              rowKey={key}
              maxCardW={maxCardW}
              previewing={previewingKey === key}
              onTogglePreview={onTogglePreview}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Grid card — an aspect-true tile in the wrapping viz grid: the shader frame
 *  (thumbnail or live hover preview) sized by its aspect at the settings height,
 *  with the name + renderer beneath and actions overlaid on hover. */
function AssetCard({
  asset,
  rowKey,
  maxCardW,
  previewing,
  onTogglePreview,
}: {
  asset: Asset;
  rowKey: string;
  maxCardW: number;
  previewing: boolean;
  onTogglePreview: (key: string, asset: Asset) => void;
}) {
  const { hovered, copied, actions, hoverProps } = useRowActions(
    asset,
    rowKey,
    previewing,
    onTogglePreview,
  );

  const previewHeight = useVizPreviewHeight();
  // Card size = the shader's aspect at the chosen height. Aspect comes from the
  // thumbnail's natural size once it loads (baked frames are 2:1, placeholders
  // 1:1); default 2:1 so the current corpus doesn't jump on load. Width follows
  // height×aspect but is capped to one column; when capped, height YIELDS so the
  // frame stays aspect-true — never cropped, never overflowing the sidebar.
  const [aspect, setAspect] = useState(2);
  const wUncapped = previewHeight * aspect;
  const boxW = maxCardW > 0 ? Math.min(wUncapped, maxCardW) : wUncapped;
  const boxH = boxW / aspect;

  // ShaderToy-style live preview: while hovered, mount the real viz (muted) over
  // the static tile; tear it down on leave/unmount so only one is ever alive
  // (#838). `live` fades the static thumbnail out once the canvas is up.
  const previewHost = useRef<HTMLDivElement | null>(null);
  const mountPreviewRef = useRef(asset.mountLivePreview);
  mountPreviewRef.current = asset.mountLivePreview;
  const [live, setLive] = useState(false);
  // Key on `rowKey` (stable `type:id`), NOT `asset`: the provider re-lists on
  // every tick so `asset` is a fresh object each render — depending on it would
  // remount the worker preview on an unrelated tick mid-hover. Read the current
  // mount fn via a ref so a re-list can't stale it either.
  useEffect(() => {
    const host = previewHost.current;
    const mount = mountPreviewRef.current;
    if (!hovered || !mount || !host) return;
    const size = { w: host.clientWidth || 120, h: host.clientHeight || 64 };
    const handle = mount(host, size);
    if (!handle) return; // worker path unavailable → keep the static tile
    setLive(true);
    return () => {
      handle.disconnect();
      setLive(false);
    };
  }, [hovered, rowKey]);

  return (
    <div style={{ ...styles.card, width: boxW }} {...hoverProps} data-asset-row={rowKey}>
      <div
        style={{ ...styles.cardThumbWrap, width: boxW, height: boxH }}
        data-viz-preview-box={rowKey}
      >
        {asset.thumbnail && (
          <img
            src={asset.thumbnail}
            alt=""
            // Read the shader's true aspect from the (baked or placeholder) tile.
            onLoad={(e) => {
              const im = e.currentTarget;
              if (im.naturalWidth > 0 && im.naturalHeight > 0) {
                setAspect(im.naturalWidth / im.naturalHeight);
              }
            }}
            style={{ ...styles.cardThumb, ...(live ? styles.cardThumbHidden : {}) }}
            data-asset-thumb={rowKey}
          />
        )}
        {asset.mountLivePreview && (
          <div
            ref={previewHost}
            style={styles.cardPreviewHost}
            data-viz-preview={rowKey}
            aria-hidden
          />
        )}
        {(hovered || previewing || copied) && (
          <div style={styles.cardActions}>{actions(styles.cardBtn)}</div>
        )}
      </div>
      <span style={styles.cardName}>{asset.name}</span>
      {asset.group && <span style={styles.rowGroup}>{asset.group}</span>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // #1541 — a drop target has to LOOK like one while a file is over it, or the
  // only feedback is the cursor, which the browser owns and which says nothing
  // about whether this panel will take it.
  dropping: {
    outline: "1px dashed var(--accent, #6ea8fe)",
    outlineOffset: -3,
  },
  root: {
    // Width is owned by SidePanel (#1367) — and this panel already
    // re-measures its content width on every panel resize, so it wants a
    // width it does not choose.
    width: "100%",
    height: "100%",
    background: "var(--bg-panel)",
    borderRight: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: 0,
  },
  header: {
    padding: "10px 14px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.8,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  headerClose: {
    background: "none",
    border: "none",
    color: "var(--text-icon-muted)",
    cursor: "pointer",
    padding: 2,
    display: "flex",
    alignItems: "center",
  },
  controls: {
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    borderBottom: "1px solid var(--border-subtle)",
  },
  search: {
    width: "100%",
    boxSizing: "border-box",
    padding: "6px 8px",
    fontSize: 12,
    color: "var(--text-primary)",
    background: "var(--bg-input, var(--bg-chrome))",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    outline: "none",
    fontFamily: "inherit",
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },
  // Category tags: capped at 2 rows that scroll horizontally (a column-flow
  // grid — chips fill top-then-bottom per column, the belt overflows sideways).
  // The scrollbar is hidden via a globals.css `::-webkit-scrollbar` rule on the
  // `[data-filter="asset-category-filter"]` selector (inline can't do pseudos).
  categoryChipRow: {
    display: "grid",
    gridAutoFlow: "column",
    gridTemplateRows: "repeat(2, auto)",
    gridAutoColumns: "max-content",
    gap: 4,
    // Separator from the Type filter above — the tag belt is a secondary axis.
    borderTop: "1px solid var(--border-subtle)",
    paddingTop: 8,
    overflowX: "auto",
    overflowY: "hidden",
    // Hide the scrollbar cross-browser: `scrollbarWidth` covers Firefox (which
    // ignores the webkit pseudo); the globals.css `::-webkit-scrollbar` rule
    // covers Blink/WebKit. The belt still scrolls. (Same dual pattern as
    // WorkspaceShell's tabbar.)
    scrollbarWidth: "none",
  },
  chip: {
    padding: "2px 8px",
    fontSize: 11,
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    background: "transparent",
    // Longhand (not the `border` shorthand) so `chipActive`'s borderColor
    // override doesn't mix shorthand+longhand on re-render (React warns).
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border-subtle)",
    borderRadius: 10,
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1.6,
  },
  chipActive: {
    color: "var(--text-primary)",
    background: "var(--accent-soft, var(--bg-chrome))",
    borderColor: "var(--accent-strong)",
  },
  chipCount: {
    opacity: 0.6,
    fontVariantNumeric: "tabular-nums",
  },
  listScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    // Darker surface for the asset list → the content area recedes beneath the
    // lighter search + filter controls (visual hierarchy).
    background: "var(--bg-inset, rgba(0,0,0,0.22))",
  },
  listEmpty: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    fontSize: 12,
    color: "var(--text-tertiary)",
    textAlign: "center",
    background: "var(--bg-inset, rgba(0,0,0,0.22))",
  },
  row: {
    position: "absolute",
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 8px 0 14px",
    boxSizing: "border-box",
    gap: 6,
  },
  rowThumb: {
    width: 26,
    height: 26,
    flexShrink: 0,
    borderRadius: 5,
    objectFit: "cover",
    background: "var(--bg-inset, rgba(127,127,127,0.12))",
    border: "1px solid var(--border-subtle)",
  },
  gridScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    // Same darker surface as the list — the card grid recedes beneath the
    // lighter search + filter controls (visual hierarchy).
    background: "var(--bg-inset, rgba(0,0,0,0.22))",
  },
  cardGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    padding: 12,
    alignContent: "flex-start",
    alignItems: "flex-start", // top-align cards of differing aspect/height
    boxSizing: "border-box",
  },
  card: {
    // Sized to its content: the thumb box is width height×aspect (capped to one
    // column), so the card takes that width and the flex row reflows around it.
    flex: "0 0 auto",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    boxSizing: "border-box",
  },
  cardThumbWrap: {
    position: "relative",
    lineHeight: 0, // drop the inline-image descender gap
    // width + height are set inline (the shader's aspect at the settings height).
  },
  cardThumb: {
    width: "100%",
    height: "100%",
    display: "block",
    objectFit: "cover", // fill the settings-controlled fixed height, no distortion
    borderRadius: 6,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-inset, rgba(127,127,127,0.12))",
    transition: "opacity 160ms ease",
  },
  // Fade the static tile out once the live canvas is painting (leave it in the
  // layout so the card keeps its aspect-true height).
  cardThumbHidden: {
    opacity: 0,
  },
  // Overlays the thumbnail box; the live worker canvas mounts here on hover.
  // `inset:0` fills the tile; the child <canvas> is sized to this box in px.
  cardPreviewHost: {
    position: "absolute",
    inset: 0,
    borderRadius: 6,
    overflow: "hidden",
    pointerEvents: "none",
  },
  cardActions: {
    position: "absolute",
    top: 4,
    right: 4,
    display: "flex",
    gap: 2,
    padding: 2,
    borderRadius: 5,
    background: "rgba(0,0,0,0.5)",
  },
  cardBtn: {
    width: 22,
    height: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    borderRadius: 4,
    color: "rgba(255,255,255,0.9)",
    cursor: "pointer",
    padding: 0,
  },
  cardName: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
  },
  rowName: {
    fontSize: 12,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowGroup: {
    fontSize: 10,
    color: "var(--text-tertiary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowActions: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
  rowBtn: {
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    borderRadius: 4,
    color: "var(--text-icon-muted)",
    cursor: "pointer",
    padding: 0,
  },
  rowBtnActive: {
    color: "var(--accent-strong)",
  },
};
