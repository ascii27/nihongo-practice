import { useCallback, useEffect, useRef, useState } from "react";
import type { Focus, LibraryItem, TagSummary } from "@nihongo/shared";
import { fetchLibrary, createTag, updateTag, deleteTag } from "../api-hooks";
import { SKILL_META } from "../lib/skills";
import { FocusPickers } from "../components/FocusPickers";
import { AddCards } from "../components/AddCards";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { ItemDetailSheet } from "../components/ItemDetailSheet";
import { IconClose, IconSearch } from "../components/icons";

type Props = {
  tags: TagSummary[];
  onTagsChanged: () => void;
  onReviewTag: (tagId: string) => void;
};

// Matches the server's page size (LIBRARY_PAGE), so one server page is one pager page.
const PAGE_SIZE = 50;

type Sheet = "new-tag" | "manage" | "confirm-delete" | "add" | null;

// Everything in the deck, searchable and filterable by skill and tag; tags are
// created and managed here. Fixed to the viewport like a paged list (ASC-19):
// the rows scroll inside their own list and the pager stays pinned at the foot.
export function LibraryScreen({ tags, onTagsChanged, onReviewTag }: Props) {
  const [filter, setFilter] = useState<Focus>({});
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const itemsRef = useRef<HTMLUListElement>(null);

  const query = q.trim();
  const load = useCallback(async () => {
    const r = await fetchLibrary({ q: query || undefined, ...filter, offset: page * PAGE_SIZE });
    setItems(r.items);
    setTotal(r.total);
    setLoaded(true);
  }, [query, filter, page]);

  useEffect(() => { void load(); }, [load]);
  // A new page starts at its top rather than wherever the last one was left.
  useEffect(() => {
    if (itemsRef.current) itemsRef.current.scrollTop = 0;
  }, [page]);

  // Any change to what's being looked at goes back to the first page.
  function changeFilter(f: Focus) { setFilter(f); setPage(0); }
  function changeQuery(v: string) { setQ(v); setPage(0); }

  // Null briefly after creating a tag, until the refreshed tag list arrives.
  // Deleting a tag clears the filter explicitly (see ConfirmTagDelete below).
  const activeTag = tags.find((t) => t.id === filter.tag) ?? null;

  const refreshAll = useCallback(async () => {
    onTagsChanged();
    await load();
  }, [onTagsChanged, load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="screen library">
      <h1 className="lessons__title library__title">Library</h1>

      <div className="browse__search library__search">
        <span className="browse__search-icon"><IconSearch /></span>
        <input value={q} onChange={(e) => changeQuery(e.target.value)}
               placeholder="Search vocab, grammar, kanji…" aria-label="Search library" />
      </div>
      <div className="library__pickers">
        <FocusPickers focus={filter} tags={tags} onChange={changeFilter} />
      </div>

      {activeTag ? (
        <section className="library__tag-header" aria-label="Tag">
          <div className="library__tag-title-row">
            <h2 className="library__tag-name">{activeTag.name}</h2>
            <span className="library__tag-mastery">{Math.round(activeTag.avg_mastery * 100)}% mastered</span>
          </div>
          <div className="library__tag-actions">
            <button type="button" className="cta cta--primary" disabled={activeTag.item_count === 0}
                    onClick={() => onReviewTag(activeTag.id)}>
              Review this tag
            </button>
            <button type="button" className="cta" onClick={() => setSheet("add")}>Add cards</button>
            <button type="button" className="cta" onClick={() => setSheet("manage")}>Manage tag</button>
          </div>
        </section>
      ) : (
        <div className="library__tag-chips" aria-label="Your tags">
          {tags.map((t) => (
            <button key={t.id} type="button" className="tag-chip"
                    onClick={() => changeFilter({ ...filter, tag: t.id })}>
              {t.name} <span className="tag-chip__count">· {t.item_count}</span>
            </button>
          ))}
          <button type="button" className="tag-chip tag-chip--new" onClick={() => setSheet("new-tag")}>
            + New tag
          </button>
        </div>
      )}

      <p className="library__count">
        {total} card{total === 1 ? "" : "s"}
        {pageCount > 1 && <> · showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + items.length}</>}
      </p>

      <ul className="library__items" ref={itemsRef}>
        {items.map((it) => (
          <li key={it.id} className="study-item">
            <button type="button" className="study-item__open" onClick={() => setOpenItemId(it.id)}>
              <span className="study-item__chip">{SKILL_META[it.skill]?.short ?? "?"}</span>
              <span className="study-item__body">
                <span className="study-item__front">{it.front}</span>
                <span className="study-item__meaning">{it.meaning}</span>
                {it.user_tags.length > 0 && (
                  <span className="library__row-tags">
                    {it.user_tags.map((t) => <span key={t.id} className="tag-pill">{t.name}</span>)}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
        {loaded && items.length === 0 && (
          <li className="muted study__empty">
            {activeTag && !query && !filter.skill ? "No cards with this tag yet — add some." : "No matching cards."}
          </li>
        )}
      </ul>

      {pageCount > 1 && (
        <nav className="study-detail__pager" aria-label="Pages">
          <button type="button" className="cta" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="study-detail__pager-label">Page {page + 1} of {pageCount}</span>
          <button type="button" className="cta" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}

      {sheet === "new-tag" && (
        <NewTagSheet
          onClose={() => setSheet(null)}
          onCreated={(id) => { setSheet(null); onTagsChanged(); changeFilter({ ...filter, tag: id }); }}
        />
      )}
      {sheet === "manage" && activeTag && (
        <ManageTagSheet
          tag={activeTag}
          onClose={() => setSheet(null)}
          onRenamed={() => { setSheet(null); onTagsChanged(); }}
          onDelete={() => setSheet("confirm-delete")}
        />
      )}
      {sheet === "confirm-delete" && activeTag && (
        <ConfirmTagDelete
          tag={activeTag}
          onCancel={() => setSheet(null)}
          onDeleted={() => { setSheet(null); changeFilter({ ...filter, tag: undefined }); onTagsChanged(); }}
        />
      )}
      {sheet === "add" && activeTag && (
        <AddCards tagId={activeTag.id} tagName={activeTag.name} onChanged={refreshAll} onClose={() => setSheet(null)} />
      )}
      {openItemId && (
        <ItemDetailSheet itemId={openItemId} tags={tags} onClose={() => setOpenItemId(null)} onTagsChanged={refreshAll} />
      )}
    </main>
  );
}

function SheetFrame({ label, kicker, onClose, children }: {
  label: string; kicker: string; onClose: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__bar">
          <span className="sheet__kicker">{kicker}</span>
          <button type="button" className="practice-bar__close" onClick={onClose} aria-label={`Close ${label.toLowerCase()}`}>
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NewTagSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await createTag({ name: name.trim() });
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't create the tag");
      setBusy(false);
    }
  }

  return (
    <SheetFrame label="New tag" kicker="New tag" onClose={onClose}>
      <form className="lessons__form" onSubmit={submit}>
        <label className="settings__field">
          <span className="settings__field-label">Tag name</span>
          <input className="settings__input" placeholder="e.g. Coto Academy" maxLength={60} autoFocus
                 value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </label>
        {error && <p className="muted" role="alert" style={{ color: "var(--error)" }}>{error}</p>}
        <button type="submit" className="cta cta--primary cta--block" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create tag"}
        </button>
      </form>
    </SheetFrame>
  );
}

function ManageTagSheet({ tag, onClose, onRenamed, onDelete }: {
  tag: TagSummary; onClose: () => void; onRenamed: () => void; onDelete: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === tag.name) return;
    setBusy(true);
    setError(null);
    try {
      await updateTag(tag.id, { name: name.trim() });
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "rename failed");
      setBusy(false);
    }
  }

  return (
    <SheetFrame label="Manage tag" kicker={tag.name} onClose={onClose}>
      <form className="lessons__form" onSubmit={save}>
        <label className="settings__field">
          <span className="settings__field-label">Tag name</span>
          <input className="settings__input" maxLength={60} value={name}
                 onChange={(e) => setName(e.target.value)} disabled={busy} />
        </label>
        {error && <p className="muted" role="alert" style={{ color: "var(--error)" }}>{error}</p>}
        <button type="submit" className="cta cta--primary cta--block"
                disabled={busy || !name.trim() || name.trim() === tag.name}>
          Save name
        </button>
      </form>
      <button type="button" className="linkbtn study-detail__delete" onClick={onDelete}>Delete tag</button>
    </SheetFrame>
  );
}

function ConfirmTagDelete({ tag, onCancel, onDeleted }: {
  tag: TagSummary; onCancel: () => void; onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await deleteTag(tag.id);
      onDeleted();
    } finally {
      setBusy(false);
    }
  }
  return <ConfirmDelete title={tag.name} count={tag.item_count} busy={busy} onCancel={onCancel} onConfirm={confirm} />;
}
