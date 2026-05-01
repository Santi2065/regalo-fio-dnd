import { useState } from "react";
import AssetBrowser from "./AssetBrowser";
import ManualsList from "./manuals/ManualsList";
import { Tabs } from "./ui";
import { readJSON, writeJSON } from "../lib/persistence";

type LibraryTab = "assets" | "manuals";

const LS_KEY = "library-tab";

interface Props {
  sessionId: string;
}

export default function LibraryBrowser({ sessionId }: Props) {
  const [tab, setTab] = useState<LibraryTab>(
    () => readJSON<LibraryTab>(LS_KEY, "assets")
  );

  const handleChange = (next: LibraryTab) => {
    setTab(next);
    writeJSON(LS_KEY, next);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-2 flex-shrink-0 border-b border-parchment-800">
        <Tabs<LibraryTab>
          items={[
            { key: "assets", label: "🖼 Assets" },
            { key: "manuals", label: "📖 Manuales" },
          ]}
          active={tab}
          onChange={handleChange}
        />
      </div>
      <div className="flex-1 min-h-0">
        <div className={tab === "assets" ? "h-full" : "hidden"}>
          <AssetBrowser sessionId={sessionId} />
        </div>
        <div className={tab === "manuals" ? "h-full" : "hidden"}>
          <ManualsList />
        </div>
      </div>
    </div>
  );
}
