import { invoke } from "@tauri-apps/api/core";

export interface Manual {
  id: string;
  name: string;
  file_path: string;
  page_count: number | null;
  language: string | null;
  indexed_at: string | null;
  created_at: string;
  chunk_count: number;
}

export interface SearchHit {
  manual_id: string;
  manual_name: string;
  manual_file_path: string;
  page_number: number;
  section_path: string | null;
  text: string;
  score: number;
}

export interface ImportProgress {
  job_id: string;
  phase: "extracting" | "chunking" | "inserting" | "done" | "error";
  percent: number;
  status_text: string;
}

export const getManuals = () => invoke<Manual[]>("get_manuals");

export const deleteManual = (id: string) => invoke<void>("delete_manual", { id });

export const importManual = (filePath: string, name?: string) =>
  invoke<string>("import_manual", { filePath, name: name ?? null });

export const searchManuals = (
  query: string,
  limit = 10,
  manualFilter?: string[]
) =>
  invoke<SearchHit[]>("search_manuals", {
    query,
    limit,
    manualFilter: manualFilter ?? null,
  });
