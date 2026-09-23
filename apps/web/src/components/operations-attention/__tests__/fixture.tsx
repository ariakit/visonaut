import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OperationsAttention } from "../index.tsx";
import "../../../review.css";
import "../../../routes/dashboard.css";

function Fixture() {
  const [denied, setDenied] = useState<number | null>(null);
  return (
    <main className="dashboard dashboard-main">
      {denied ? (
        <p role="alert">{denied === 401 ? "Sign in required" : "Repository access required"}</p>
      ) : (
        <OperationsAttention onAccessDenied={setDenied} />
      )}
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
