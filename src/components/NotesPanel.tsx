import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note } from "../lib/types";
import { toast } from "../lib/toast";

interface Props {
  sessionId: string;
  compact?: boolean;
}

export default function NotesPanel({ sessionId, compact = false }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<Note[]>("get_notes", { sessionId });
      setNotes(result);
    } catch (e) {
      console.error("[NotesPanel] fetch failed", e);
      toast.error("No se pudieron cargar las notas");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const selectNote = (note: Note) => {
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setPreview(false);
  };

  const handleSave = async (opts?: { silent?: boolean }) => {
    if (!selectedNote) return;
    setSaving(true);
    try {
      const updated = await invoke<Note>("update_note", {
        id: selectedNote.id,
        title: editTitle,
        content: editContent,
      });
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      setSelectedNote(updated);
      if (!opts?.silent) toast.success("Nota guardada");
    } catch (e) {
      console.error("[NotesPanel] save failed", e);
      toast.error("No se pudo guardar la nota");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const note = await invoke<Note>("create_note", {
        sessionId,
        title: newTitle.trim(),
        content: "",
      });
      setNotes((prev) => [note, ...prev]);
      setNewTitle("");
      setCreating(false);
      selectNote(note);
    } catch (e) {
      console.error("[NotesPanel] create failed", e);
      toast.error("No se pudo crear la nota");
    }
  };

  const handleDelete = async (note: Note) => {
    try {
      await invoke("delete_note", { id: note.id });
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      if (selectedNote?.id === note.id) setSelectedNote(null);
      toast.success("Nota eliminada");
    } catch (e) {
      console.error("[NotesPanel] delete failed", e);
      toast.error("No se pudo eliminar la nota");
    }
  };

  const isDirty =
    selectedNote &&
    (editContent !== selectedNote.content || editTitle !== selectedNote.title);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-AR", { month: "short", day: "numeric" });

  if (compact) {
    return (
      <div className="flex flex-col h-full">
        {/* Compact top bar: dropdown + new */}
        <div className="flex items-center gap-1.5 px-2 py-2 border-b border-stone-800 flex-shrink-0">
          <select
            value={selectedNote?.id ?? ""}
            onChange={(e) => {
              const note = notes.find((n) => n.id === e.target.value);
              if (note) selectNote(note);
            }}
            className="flex-1 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500 min-w-0"
          >
            <option value="" disabled>{loading ? "Cargando..." : notes.length === 0 ? "Sin notas" : "Seleccioná una nota"}</option>
            {notes.map((n) => (
              <option key={n.id} value={n.id}>{n.title}</option>
            ))}
          </select>
          <button
            onClick={() => setCreating((c) => !c)}
            className="w-7 h-7 flex items-center justify-center text-amber-500 hover:text-amber-400 text-lg leading-none transition-colors flex-shrink-0"
            title="Nueva nota"
          >
            +
          </button>
          {selectedNote && (
            <button
              onClick={() => handleDelete(selectedNote)}
              className="w-7 h-7 flex items-center justify-center text-stone-600 hover:text-red-400 text-xs transition-colors flex-shrink-0"
              title="Eliminar nota"
            >
              ×
            </button>
          )}
        </div>

        {creating && (
          <form onSubmit={handleCreate} className="px-2 py-2 border-b border-stone-800 flex-shrink-0">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Título..."
              className="w-full bg-stone-800 border border-amber-600 rounded px-2 py-1 text-xs text-stone-200 placeholder-stone-500 focus:outline-none"
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
            />
            <div className="flex gap-1 mt-1">
              <button type="submit" disabled={!newTitle.trim()} className="flex-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white py-1 rounded text-xs transition-colors">Crear</button>
              <button type="button" onClick={() => setCreating(false)} className="flex-1 bg-stone-700 text-stone-400 py-1 rounded text-xs hover:bg-stone-600 transition-colors">Cancelar</button>
            </div>
          </form>
        )}

        {/* Compact editor */}
        {selectedNote ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-stone-800 flex-shrink-0">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 bg-transparent text-stone-200 text-xs font-medium focus:outline-none min-w-0"
              />
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setPreview((p) => !p)} className={`px-2 py-0.5 rounded text-xs transition-colors ${preview ? "bg-stone-600 text-stone-200" : "bg-stone-800 text-stone-400 hover:text-stone-200"}`}>
                  {preview ? "✎" : "👁"}
                </button>
                {isDirty && (
                  <button onClick={handleSave} disabled={saving} className="bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors">
                    {saving ? "..." : "Guardar"}
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {preview ? (
                <div className="px-4 py-3 prose prose-invert prose-xs max-w-none text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{editContent || "*Vacía*"}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Markdown..."
                  className="w-full h-full bg-transparent text-stone-300 text-xs font-mono resize-none focus:outline-none px-3 py-3 leading-relaxed placeholder-stone-700"
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-stone-600 text-xs text-center px-4">
            Seleccioná o creá una nota
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-60 flex-shrink-0 border-r border-stone-800 flex flex-col bg-stone-900/30">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <span className="text-sm font-medium text-stone-400">Notas</span>
          <button
            onClick={() => setCreating(true)}
            className="text-amber-500 hover:text-amber-400 text-lg leading-none transition-colors"
            title="Nueva nota"
          >
            +
          </button>
        </div>

        {/* New note input */}
        {creating && (
          <form onSubmit={handleCreate} className="px-3 py-2 border-b border-stone-800">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Título de la nota..."
              className="w-full bg-stone-800 border border-amber-600 rounded px-2 py-1 text-sm text-stone-200 placeholder-stone-500 focus:outline-none"
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
            />
            <div className="flex gap-1 mt-1.5">
              <button
                type="submit"
                disabled={!newTitle.trim()}
                className="flex-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white py-1 rounded text-xs transition-colors"
              >
                Crear
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="flex-1 bg-stone-700 text-stone-400 py-1 rounded text-xs hover:bg-stone-600 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-stone-600 text-sm py-8">Cargando...</div>
          ) : notes.length === 0 ? (
            <div className="text-center text-stone-600 text-sm py-8 px-4">
              Sin notas. Creá una con el + de arriba.
            </div>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                onClick={() => selectNote(note)}
                className={`group px-4 py-3 cursor-pointer border-b border-stone-800/50 transition-colors ${
                  selectedNote?.id === note.id
                    ? "bg-stone-800"
                    : "hover:bg-stone-800/50"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="text-sm text-stone-200 truncate flex-1">{note.title}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(note); }}
                    className="opacity-0 group-hover:opacity-100 text-stone-600 hover:text-red-400 text-xs transition-opacity"
                  >
                    ×
                  </button>
                </div>
                <p className="text-xs text-stone-600 mt-0.5">
                  {formatDate(note.updated_at)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedNote ? (
          <>
            {/* Note header */}
            <div className="flex items-center gap-3 px-6 py-3 border-b border-stone-800 flex-shrink-0">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 bg-transparent text-stone-100 font-semibold text-base focus:outline-none border-b border-transparent focus:border-stone-600 pb-0.5 transition-colors"
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setPreview((p) => !p)}
                  className={`px-3 py-1 rounded text-xs transition-colors ${
                    preview
                      ? "bg-stone-600 text-stone-200"
                      : "bg-stone-800 text-stone-400 hover:text-stone-200"
                  }`}
                >
                  {preview ? "✎ Editar" : "👁 Preview"}
                </button>
                {isDirty && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
                  >
                    {saving ? "..." : "Guardar"}
                  </button>
                )}
              </div>
            </div>

            {/* Editor / Preview */}
            <div className="flex-1 overflow-y-auto">
              {preview ? (
                <div className="px-8 py-6 prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {editContent || "*Nota vacía*"}
                  </ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Escribí tu nota en Markdown...

# Título
## Sección

- Item 1
- Item 2

**negrita**, *cursiva*, `código`"
                  className="w-full h-full bg-transparent text-stone-300 text-sm font-mono resize-none focus:outline-none px-8 py-6 leading-relaxed placeholder-stone-700"
                  onKeyDown={(e) => {
                    // Auto-save on Ctrl+S
                    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                      e.preventDefault();
                      handleSave();
                    }
                    // Tab indentation
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end = e.currentTarget.selectionEnd;
                      setEditContent(
                        editContent.substring(0, start) + "  " + editContent.substring(end)
                      );
                      setTimeout(() => {
                        e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
                      }, 0);
                    }
                  }}
                />
              )}
            </div>

            {/* Footer with shortcut hint */}
            <div className="flex-shrink-0 px-6 py-2 border-t border-stone-900 text-xs text-stone-700">
              Ctrl+S para guardar · Preview con el botón de arriba · Markdown soportado
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <div className="text-5xl mb-3">📝</div>
              <p className="text-stone-500 text-sm">Seleccioná una nota o creá una nueva</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
