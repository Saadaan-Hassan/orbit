import { ActivityTimeline } from "./components/ActivityTimeline";
import { RecallSearch } from "./components/RecallSearch";

function App() {
  return (
    <main className="max-w-2xl mx-auto py-6 font-sans">
      <h1 className="text-2xl font-bold px-4 mb-6">🪐 Orbit</h1>
      <RecallSearch />
      <hr className="my-4 border-gray-200" />
      <ActivityTimeline />
    </main>
  );
}

export default App;
