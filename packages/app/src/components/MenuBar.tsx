"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { TransportLCD } from "./TransportLCD";
import { TimeSignatureControl } from "./TimeSignatureControl";
import { useMenubarLcd } from "../state/menubarLcd";

const GITHUB_REPO_URL = "https://github.com/MrityunjayBhardwaj/stave-code";

// Backdrop selection used to live in a menubar bg-indicator + popover here.
// As of #347 the backdrop is per-tab, set from the pattern bar's "set bg"
// dropdown (and VizEditorChrome), so the menubar no longer owns it.
interface MenuBarProps {
  projectName: string;
  onOpenEditorSettings: () => void;
  onOpenShortcuts: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onRenameProject: () => void;
  onExportProject: () => void;
  /** #1346 — real-time bounce of the live output to a .wav. */
  onBounceToWav: () => void;
  /**
   * #1356 — whether the active tab HAS a recordable runtime. Read at render,
   * i.e. when the menu opens, so it reflects the tab in front of the user.
   *
   * The palette entry for the same command already gates on this via `when`.
   * Without it here the two entry points disagreed: the menu let the user open
   * the modal and choose a length before telling them it could not bounce.
   */
  canBounceToWav: () => boolean;
  onImportProject: () => void;
  onShareProject: () => void;
  onVersionHistory: () => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  onToggleZenMode: () => void;
  zenMode: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Transport LCD data (#857). Fed from the active runtime in StaveApp. */
  isPlaying: boolean;
  getCycle: () => number | null;
  getCps: () => number | null;
}

type MenuId = "file" | "edit" | "view" | "help" | null;

export function MenuBar({
  projectName: _projectName,
  onOpenEditorSettings,
  onOpenShortcuts,
  onNewProject,
  onOpenProject,
  onRenameProject,
  onExportProject,
  onBounceToWav,
  canBounceToWav,
  onImportProject,
  onShareProject,
  onVersionHistory,
  onToggleSidebar,
  sidebarCollapsed,
  onToggleZenMode,
  zenMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isPlaying,
  getCycle,
  getCps,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lcdEnabled = useMenubarLcd();

  // Close menu on click outside OR Escape
  useEffect(() => {
    if (!openMenu) return;
    const mouseHandler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", mouseHandler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", mouseHandler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [openMenu]);

  const clickItem = useCallback((action: () => void) => {
    setOpenMenu(null);
    action();
  }, []);

  return (
    <div ref={barRef} style={styles.bar}>
      <MenuButton label="File" open={openMenu === "file"} onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}>
        <MenuItem label="New Project..." shortcut="⌘N" onClick={() => clickItem(onNewProject)} />
        <MenuItem label="Open Project..." shortcut="⌘O" onClick={() => clickItem(onOpenProject)} />
        <MenuDivider />
        <MenuItem label="Rename Project..." onClick={() => clickItem(onRenameProject)} />
        <MenuItem label="Version History..." onClick={() => clickItem(onVersionHistory)} />
        <MenuDivider />
        <MenuItem label="Import from .zip..." onClick={() => clickItem(onImportProject)} />
        <MenuItem label="Export as .zip" onClick={() => clickItem(onExportProject)} />
        <MenuItem
          label="Bounce to WAV..."
          onClick={() => clickItem(onBounceToWav)}
          disabled={!canBounceToWav()}
        />
        <MenuDivider />
        <MenuItem label="Copy Share Link" onClick={() => clickItem(onShareProject)} />
        <MenuDivider />
        <MenuItem label="Editor Settings..." onClick={() => clickItem(onOpenEditorSettings)} />
        <MenuItem label="Keyboard Shortcuts..." onClick={() => clickItem(onOpenShortcuts)} />
      </MenuButton>

      <MenuButton label="Edit" open={openMenu === "edit"} onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}>
        <MenuItem label="Undo" shortcut="⌘Z" onClick={() => clickItem(onUndo)} disabled={!canUndo} />
        <MenuItem label="Redo" shortcut="⌘⇧Z" onClick={() => clickItem(onRedo)} disabled={!canRedo} />
        <MenuDivider />
        <MenuItem label="Find..." shortcut="⌘F" onClick={() => setOpenMenu(null)} disabled />
      </MenuButton>

      <MenuButton label="View" open={openMenu === "view"} onClick={() => setOpenMenu(openMenu === "view" ? null : "view")}>
        <MenuItem
          label={sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
          shortcut="⌘B"
          onClick={() => clickItem(onToggleSidebar)}
        />
        <MenuItem
          label={zenMode ? "Exit Zen Mode" : "Zen Mode (Fullscreen)"}
          shortcut="⌘K Z"
          onClick={() => clickItem(onToggleZenMode)}
        />
      </MenuButton>

      <MenuButton label="Help" open={openMenu === "help"} onClick={() => setOpenMenu(openMenu === "help" ? null : "help")}>
        <MenuItem
          label="Documentation"
          onClick={() => clickItem(() => window.open("/docs/", "_blank", "noopener,noreferrer"))}
        />
        <MenuItem
          label="GitHub Repository"
          onClick={() => clickItem(() => window.open(GITHUB_REPO_URL, "_blank", "noopener,noreferrer"))}
        />
      </MenuButton>

      {lcdEnabled ? (
        <div style={styles.centerSlot}>
          <TransportLCD isPlaying={isPlaying} getCycle={getCycle} getCps={getCps} />
          <TimeSignatureControl />
        </div>
      ) : (
        <div data-stave-brand style={styles.brand} aria-hidden="true">
          Stave Code
        </div>
      )}

      <div style={styles.spacer} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function MenuButton({
  label, open, onClick, children,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.menuButtonWrap}>
      <button
        onClick={onClick}
        style={{ ...styles.menuButton, ...(open ? styles.menuButtonOpen : {}) }}
      >
        {label}
      </button>
      {open && <div style={styles.dropdown}>{children}</div>}
    </div>
  );
}

function MenuItem({
  label, shortcut, onClick, disabled,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      data-stave-menu-item
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ ...styles.menuItem, ...(disabled ? styles.menuItemDisabled : {}) }}
    >
      <span>{label}</span>
      {shortcut && <span style={styles.shortcut}>{shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div style={styles.divider} />;
}

// ── Styles ─────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    height: 28,
    background: "var(--bg-chrome)",
    borderBottom: "1px solid var(--border-subtle)",
    color: "var(--text-chrome)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 12,
    userSelect: "none",
    paddingLeft: 6,
  },
  brand: {
    position: "absolute" as const,
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none" as const,
    color: "var(--text-secondary)",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 0.4,
    whiteSpace: "nowrap" as const,
  },
  centerSlot: {
    position: "absolute" as const,
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    // The readout and the signature it counts in read as one cluster.
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  menuButtonWrap: {
    position: "relative" as const,
  },
  menuButton: {
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 12,
    borderRadius: 3,
  },
  menuButtonOpen: {
    background: "var(--bg-hover)",
  },
  dropdown: {
    position: "absolute" as const,
    top: "100%",
    left: 0,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    padding: "4px 0",
    zIndex: 9998,
    minWidth: 200,
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
  },
  menuItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "5px 14px",
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    fontSize: 12,
    textAlign: "left" as const,
    cursor: "pointer",
  },
  menuItemDisabled: {
    color: "var(--text-disabled)",
    cursor: "default",
  },
  shortcut: {
    color: "var(--text-muted)",
    fontSize: 11,
    marginLeft: 20,
  },
  divider: {
    height: 1,
    background: "var(--border-subtle)",
    margin: "4px 0",
  },
  spacer: {
    flex: 1,
  },
};
