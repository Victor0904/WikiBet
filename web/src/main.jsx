import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { startI18n } from "./i18n.js";
import "./styles.css";

await startI18n(); // en anglais : dictionnaire chargé et page traduite au fil de l'eau
createRoot(document.getElementById("root")).render(<App />);
