"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccentSpinner, Skeleton, useToast } from "@/components/ui";
import type { StyleChanges } from "@/lib/email/inline-style";
import { DesignPopover } from "./design-popover";
import { RewriteModal } from "./rewrite-modal";
import type { EditableAdapter, EditTarget, SaveResult } from "./editable-adapter";

// THE editor. One component, used by both the email review screen and the blog
// review screen; everything type-specific lives behind an EditableAdapter.
//
// How editing works now, and why:
//
// You type ON the rendered document. The preview iframe is same-origin
// (sandbox="allow-same-origin", still no allow-scripts, so the untrusted model
// HTML can't execute anything), which means this component — running in the
// PARENT — can reach into iframe.contentDocument, flip an element to
// contentEditable, and listen for events on it. Typing is a user interaction,
// not script, so it works inside the sandbox.
//
// That single change is what fixes the old breakage. The previous flow read a
// section's textContent into a textarea, which collapsed a multi-paragraph body
// with links and bold into one flat line, then rebuilt the section from that
// flattened string, destroying the structure. Here the section's own markup is
// never round-tripped through plain text: the user edits it in place, and the
// resulting innerHTML is sanitized and spliced straight back.
//
// Interaction model:
//   click            select the section (ring + floating toolbar)
//   click again /
//   double-click     edit it — caret goes where you clicked, type inline
//   click outside    save (skipped entirely if nothing changed)
//   Escape           revert this section and exit
//   Cmd/Ctrl+Enter   save and exit
//   Cmd+B / Cmd+I    native contentEditable formatting; survives the save
//
// The iframe is deliberately NOT re-rendered while you type (changing srcDoc
// reloads it, which would kill the caret mid-word). It is remounted only when
// html arrives from OUTSIDE this component — the design chat, an image change,
// undo — or after a save, with scroll position preserved.

/** How far below a section its toolbar sits. */
const TOOLBAR_GAP = 8;

interface InlinePreviewProps {
  adapter: EditableAdapter;
  /** The rendered preview document. */
  html: string;
  /** Raised whenever the stored document changes, so the page can keep its own state in step. */
  onHtmlChange: (result: SaveResult) => void;
  /** Raised after any successful edit, so sibling UI (the design chat's history) can refresh. */
  onEdited?: () => void;
  /** Preview-only colour scheme forcing. Never affects the stored html. */
  transformHtml?: (html: string) => string;
  /** Height of the preview surface. */
  height?: number;
  title: string;
  /** Rendered above the hotspots, e.g. the email's image controls. */
  overlay?: React.ReactNode;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function InlinePreview({
  adapter,
  html,
  onHtmlChange,
  onEdited,
  transformHtml,
  height = 600,
  title,
  overlay,
}: InlinePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  /** The html currently painted into the iframe. Only changes on a deliberate remount. */
  const [docHtml, setDocHtml] = useState(html);
  /** The last html this component itself produced — used to tell our own saves apart from outside changes. */
  const lastEmitted = useRef(html);
  /** Scroll offset to restore after a remount, so editing the footer doesn't jump you to the top. */
  const pendingScroll = useRef(0);

  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<EditTarget | null>(null);
  const [selectedRect, setSelectedRect] = useState<Rect | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /** The live DOM element being edited, and its innerHTML when editing began. */
  const editingEl = useRef<HTMLElement | null>(null);
  const editSnapshot = useRef<string>("");
  /** The selected element, tracked outside React so the iframe listeners can read it without re-attaching. */
  const selectedElRef = useRef<HTMLElement | null>(null);
  /** Guards against the blur/click-outside handler and Cmd+Enter both committing. */
  const committing = useRef(false);

  // ── Remount only for changes that did not come from us ────────────────────
  useEffect(() => {
    if (html !== lastEmitted.current) {
      lastEmitted.current = html;
      pendingScroll.current = iframeRef.current?.contentWindow?.scrollY ?? 0;
      setDocHtml(html);
    }
  }, [html]);

  /** Publishes a new document: remounts the iframe (preserving scroll) and tells the page. */
  const adoptResult = useCallback(
    (result: SaveResult) => {
      lastEmitted.current = result.html;
      pendingScroll.current = iframeRef.current?.contentWindow?.scrollY ?? 0;
      setDocHtml(result.html);
      onHtmlChange(result);
      onEdited?.();
    },
    [onHtmlChange, onEdited],
  );

  const clearSelection = useCallback(() => {
    setSelected(null);
    setSelectedRect(null);
    setDesignOpen(false);
    setConfirmingDelete(false);
  }, []);

  /** Measures an element in the iframe, in container coordinates. */
  const measure = useCallback((el: HTMLElement): Rect | null => {
    const iframe = iframeRef.current;
    const container = containerRef.current;
    if (!iframe || !container) return null;
    const r = el.getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      top: iframeRect.top - containerRect.top + r.top,
      left: iframeRect.left - containerRect.left + r.left,
      width: r.width,
      height: r.height,
    };
  }, []);

  /** Reads an element's identity the same way for email (data-region) and blog (data-field). */
  const targetOf = useCallback(
    (el: HTMLElement, doc: Document): EditTarget | null => {
      const marker = el.getAttribute(adapter.markerAttr);
      if (!marker) return null;
      // The Nth element carrying this same marker. For blog sections this is
      // exactly their data-index, so one notion of "which one" serves both.
      const siblings = Array.from(
        doc.querySelectorAll<HTMLElement>(`[${adapter.markerAttr}="${marker}"]`),
      );
      const index = Math.max(0, siblings.indexOf(el));
      return {
        marker,
        index,
        label: adapter.labelFor(marker),
        innerHtml: el.innerHTML,
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    },
    [adapter],
  );

  // ── Commit / cancel the in-place edit ─────────────────────────────────────

  const commitEdit = useCallback(async (): Promise<void> => {
    const el = editingEl.current;
    const target = selected;
    if (!el || !target || committing.current) return;
    committing.current = true;

    el.contentEditable = "false";
    el.classList.remove("__ie-editing");
    setEditing(false);
    editingEl.current = null;

    // The RAW innerHTML goes to the server, which sanitizes it authoritatively.
    // Sanitizing here too would mean shipping an HTML parser to the browser for
    // a result we'd have to redo server-side anyway (never trust the client), so
    // the client's only job is to notice whether anything actually changed.
    const next = el.innerHTML;
    const before = editSnapshot.current;

    // Nothing changed: no request, no draft version churn, no history entry.
    if (!next.trim() || next === before) {
      committing.current = false;
      return;
    }

    setBusy(true);
    try {
      const result = await adapter.save({ ...target, innerHtml: next }, next);
      adoptResult(result);
    } catch (err) {
      // Put the section back exactly as it was, so a failed save can't leave a
      // half-applied edit sitting in the preview.
      el.innerHTML = editSnapshot.current;
      toast.error(err instanceof Error ? err.message : "Couldn't save that edit.");
    } finally {
      setBusy(false);
      committing.current = false;
    }
  }, [adapter, adoptResult, selected, toast]);

  const cancelEdit = useCallback(() => {
    const el = editingEl.current;
    if (!el) return;
    el.innerHTML = editSnapshot.current;
    el.contentEditable = "false";
    el.classList.remove("__ie-editing");
    editingEl.current = null;
    setEditing(false);
  }, []);

  const beginEdit = useCallback(
    (el: HTMLElement, doc: Document, point?: { x: number; y: number }) => {
      editingEl.current = el;
      editSnapshot.current = el.innerHTML;
      el.contentEditable = "true";
      el.classList.add("__ie-editing");
      el.focus();
      setEditing(true);
      setDesignOpen(false);
      setConfirmingDelete(false);

      // Put the caret where the user actually clicked. The element only became
      // editable just now, so the browser didn't place it for us.
      if (point) {
        type WithCaret = Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const range = (doc as WithCaret).caretRangeFromPoint?.(point.x, point.y);
        const sel = doc.getSelection();
        if (range && sel) {
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
      }
      const sel = doc.getSelection();
      if (sel) {
        const range = doc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    [],
  );

  // ── Wire up the iframe document ───────────────────────────────────────────
  //
  // The listeners are attached ONCE per rendered document. They reach the
  // current callbacks through this ref rather than closing over them, because
  // those callbacks change identity on every selection: if they were effect
  // dependencies, the first click would tear the listeners down and re-arm them
  // on a `load` event that had already fired, leaving the document dead to every
  // subsequent click.
  const handlers = useRef({
    commitEdit,
    beginEdit,
    cancelEdit,
    clearSelection,
    measure,
    targetOf,
    adapter,
  });
  handlers.current = { commitEdit, beginEdit, cancelEdit, clearSelection, measure, targetOf, adapter };

  useEffect(() => {
    setLoaded(false);
    const iframe = iframeRef.current;
    if (!iframe) return;

    let detach: (() => void) | null = null;

    function onLoad() {
      // Read through the ref at CALL time, never destructured here: these
      // callbacks change identity with every selection, and a copy taken at
      // load would be permanently stale (commitEdit would keep seeing a null
      // selection and silently drop every save).
      const h = () => handlers.current;
      const markerAttr = h().adapter.markerAttr;

      const doc = iframe!.contentDocument;
      const win = iframe!.contentWindow;
      if (!doc || !win) return;

      if (pendingScroll.current) {
        win.scrollTo(0, pendingScroll.current);
        pendingScroll.current = 0;
      }

      // Affordances live in the iframe's own stylesheet rather than as overlay
      // rectangles: CSS :hover tracks the element even as it reflows while you
      // type, which a measured overlay can't. Injected by the parent, so no
      // script runs inside the sandbox. This never touches the stored html.
      // onLoad can run twice (the load event AND the already-complete path), so
      // don't stack duplicate stylesheets or duplicate listeners.
      if (doc.getElementById("__ie-style")) return;
      const style = doc.createElement("style");
      style.id = "__ie-style";
      style.textContent = `
        [${markerAttr}] { transition: outline-color .12s ease; outline: 2px solid transparent; outline-offset: 3px; border-radius: 3px; }
        [${markerAttr}]:hover { outline-color: rgba(99,102,241,.45); cursor: text; }
        .__ie-selected { outline-color: rgba(99,102,241,.9) !important; }
        .__ie-editing { outline-color: rgba(99,102,241,1) !important; background: rgba(99,102,241,.04); }
        .__ie-editing:focus { outline-color: rgba(99,102,241,1) !important; }
      `;
      doc.head?.appendChild(style);

      const findTarget = (node: EventTarget | null): HTMLElement | null => {
        // The event target belongs to the IFRAME's realm, so `instanceof
        // HTMLElement` against the parent's constructor is always false here.
        // Duck-type on closest() instead.
        const candidate = node as { closest?: (s: string) => HTMLElement | null } | null;
        const el = candidate?.closest?.(`[${markerAttr}]`) ?? null;
        if (!el) return null;
        const marker = el.getAttribute(markerAttr) ?? "";
        return h().adapter.isEditable(marker) ? el : null;
      };

      const onClick = (e: MouseEvent) => {
        const el = findTarget(e.target);

        // Clicked away from any editable section: commit and deselect.
        if (!el) {
          if (editingEl.current) void h().commitEdit();
          h().clearSelection();
          return;
        }

        // Clicked a different section while editing: commit the old one first.
        if (editingEl.current && editingEl.current !== el) {
          void h().commitEdit();
        }
        if (editingEl.current === el) return; // already typing in it

        const target = h().targetOf(el, doc);
        if (!target) return;

        // Second click on the already-selected section drops you into typing.
        const alreadySelected =
          selectedElRef.current === el && !editingEl.current;

        doc.querySelectorAll(".__ie-selected").forEach((n) => n.classList.remove("__ie-selected"));
        el.classList.add("__ie-selected");
        selectedElRef.current = el;
        setSelected(target);
        setSelectedRect(h().measure(el));
        setConfirmingDelete(false);

        if (alreadySelected) {
          h().beginEdit(el, doc, { x: e.clientX, y: e.clientY });
        }
      };

      const onDblClick = (e: MouseEvent) => {
        const el = findTarget(e.target);
        if (!el || editingEl.current === el) return;
        const target = h().targetOf(el, doc);
        if (!target) return;
        doc.querySelectorAll(".__ie-selected").forEach((n) => n.classList.remove("__ie-selected"));
        el.classList.add("__ie-selected");
        selectedElRef.current = el;
        setSelected(target);
        setSelectedRect(h().measure(el));
        h().beginEdit(el, doc, { x: e.clientX, y: e.clientY });
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (!editingEl.current) return;
        if (e.key === "Escape") {
          e.preventDefault();
          h().cancelEdit();
          return;
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void h().commitEdit();
        }
      };

      // The section grows/shrinks as you type; keep the toolbar pinned to it.
      const reposition = () => {
        const el = selectedElRef.current;
        if (el) setSelectedRect(h().measure(el));
      };

      doc.addEventListener("click", onClick);
      doc.addEventListener("dblclick", onDblClick);
      doc.addEventListener("keydown", onKeyDown);
      doc.addEventListener("input", reposition);
      win.addEventListener("scroll", reposition);
      win.addEventListener("resize", reposition);
      doc.fonts?.ready?.then(reposition).catch(() => {});

      setLoaded(true);

      detach = () => {
        doc.removeEventListener("click", onClick);
        doc.removeEventListener("dblclick", onDblClick);
        doc.removeEventListener("keydown", onKeyDown);
        doc.removeEventListener("input", reposition);
        win.removeEventListener("scroll", reposition);
        win.removeEventListener("resize", reposition);
      };
    }

    iframe.addEventListener("load", onLoad);
    // A remount is not guaranteed to fire `load` again if the document is
    // already parsed by the time this runs, so adopt it directly in that case.
    if (iframe.contentDocument?.readyState === "complete") onLoad();

    return () => {
      iframe.removeEventListener("load", onLoad);
      detach?.();
    };
    // Only the rendered document matters. Everything mutable is reached through
    // `handlers` / `selectedElRef`, so a selection never re-arms the listeners.
  }, [docHtml]);

  // Clicking the surrounding page (outside the preview entirely) also commits.
  useEffect(() => {
    if (!editing) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        void commitEdit();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [editing, commitEdit]);

  // ── Toolbar actions ───────────────────────────────────────────────────────

  async function runAdapter(fn: () => Promise<SaveResult>, failure: string) {
    setBusy(true);
    try {
      adoptResult(await fn());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  async function handleStyle(changes: StyleChanges) {
    if (!selected || !adapter.applyStyle) return;
    await runAdapter(
      () => adapter.applyStyle!(selected, changes),
      "Couldn't apply that change.",
    );
  }

  async function handleDelete() {
    if (!selected) return;
    const target = selected;
    clearSelection();
    await runAdapter(() => adapter.remove(target), "Couldn't delete that section.");
  }

  /**
   * "Use this" in the rewrite modal. The model gave us TEXT; how that text
   * becomes stored content is the adapter's business (an email wraps it in the
   * section's paragraph markup, a blog stores it as markdown). Either way it
   * lands through the same deterministic path as text the user typed — the
   * model never authors markup.
   */
  async function acceptRewrite(text: string) {
    if (!selected) return;
    setBusy(true);
    try {
      adoptResult(await adapter.applyText(selected, text));
    } finally {
      setBusy(false);
    }
  }

  const doc = iframeRef.current?.contentDocument ?? null;
  const canDelete = !!selected && !!doc && adapter.canDelete(selected, doc);
  const deleteBlocked =
    selected && doc ? adapter.deleteBlockedReason?.(selected, doc) ?? null : null;

  const toolbarTop = selectedRect ? selectedRect.top + selectedRect.height + TOOLBAR_GAP : 0;
  const toolbarLeft = selectedRect ? selectedRect.left : 0;
  const showToolbar = !!selected && !!selectedRect && !editing && !rewriteOpen;

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {!loaded && (
        <div className="absolute inset-0 z-10 space-y-3 bg-white p-8">
          <Skeleton height={28} width="60%" />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="80%" />
          <Skeleton height={40} width="40%" className="mt-6 rounded-full" />
        </div>
      )}

      <iframe
        ref={iframeRef}
        key={`${docHtml}::${transformHtml ? "t" : "r"}`}
        title={title}
        srcDoc={transformHtml ? transformHtml(docHtml) : docHtml}
        sandbox="allow-same-origin"
        style={{ height }}
        className="w-full bg-white"
      />

      {loaded && overlay}

      {editing && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full bg-foreground/85 px-3 py-1.5 text-[11.5px] font-medium text-background shadow-lg backdrop-blur">
          Editing. Click outside to save, Esc to cancel.
        </div>
      )}

      {busy && (
        <div className="absolute right-3 bottom-3 z-30 flex items-center gap-1.5 rounded-full bg-surface-2/90 px-3 py-1.5 text-[11.5px] font-medium text-foreground shadow-sm backdrop-blur">
          <AccentSpinner size={12} /> Saving…
        </div>
      )}

      {showToolbar && selected && (
        <div
          style={{ top: toolbarTop, left: toolbarLeft }}
          className="absolute z-30 flex items-center gap-1 rounded-full border border-border bg-surface-1 px-1 py-1 shadow-lg"
        >
          <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {selected.label}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRewriteOpen(true)}
            className="rounded-full px-2.5 py-1 text-[12.5px] font-medium text-foreground transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            ✨ Rewrite
          </button>
          {adapter.applyStyle && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDesignOpen((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
                designOpen ? "bg-surface-3 text-foreground" : "text-foreground hover:bg-surface-3"
              }`}
            >
              🎨 Design
            </button>
          )}
          {canDelete &&
            (confirmingDelete ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete()}
                className="rounded-full bg-danger px-2.5 py-1 text-[12.5px] font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
              >
                Delete?
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
                className="rounded-full px-2.5 py-1 text-[12.5px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                aria-label={`Delete ${selected.label}`}
              >
                🗑
              </button>
            ))}
          {!canDelete && deleteBlocked && (
            <span className="px-2 text-[11px] text-muted">{deleteBlocked}</span>
          )}
        </div>
      )}

      {designOpen && selected && selectedRect && adapter.applyStyle && (
        <DesignPopover
          snippet={selectedElRef.current?.outerHTML ?? ""}
          anchor={{ top: toolbarTop + 42, left: toolbarLeft }}
          busy={busy}
          onApply={(changes) => void handleStyle(changes)}
          onClose={() => setDesignOpen(false)}
        />
      )}

      {selected && (
        <RewriteModal
          open={rewriteOpen}
          label={selected.label}
          currentText={selected.text}
          onClose={() => setRewriteOpen(false)}
          onRequest={(instruction) => adapter.rewrite(selected, instruction)}
          onAccept={acceptRewrite}
        />
      )}
    </div>
  );
}
