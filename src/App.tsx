import { HashRouter, Routes, Route } from "react-router-dom";
import SessionList from "./pages/SessionList";
import SessionDashboard from "./pages/SessionDashboard";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<SessionList />} />
        <Route path="/session/:id" element={<SessionDashboard />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
