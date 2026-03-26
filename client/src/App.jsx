/**
 * =============================================================================
 * App.jsx — Main React Component for the Simple Search Engine UI
 * =============================================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * This component is the single page of our search engine application.
 * When the user types a query and clicks "Search", the following happens:
 *
 *   1. The `handleSearch` function is called (triggered by form submission).
 *
 *   2. We set `isLoading` to true, which renders a spinner in the UI so the
 *      user knows the search is in progress.
 *
 *   3. We send a POST request to `/api/search` with the JSON body:
 *        { "query": "user's search terms" }
 *
 *   4. The Express backend receives this, spawns the C++ engine binary via
 *      `child_process.execFile`, passes the query as a CLI argument, and
 *      captures the engine's stdout (which is a JSON array of results).
 *
 *   5. The backend returns the parsed results as:
 *        { "success": true, "results": [ { "document": "...", "score": 0.85 }, ... ] }
 *
 *   6. This component receives the response, updates the `results` state,
 *      and React re-renders the UI to display each result as a card showing:
 *        • A rank number (based on array position)
 *        • The document filename
 *        • The term frequency (TF) score
 *
 *   7. If anything goes wrong (network error, engine not found, timeout, etc.),
 *      we catch the error and display a user-friendly error message.
 *
 * STATE MANAGEMENT
 * ----------------
 * We use React's `useState` hook to manage four pieces of state:
 *   - query:     The current text in the search input.
 *   - results:   Array of search results from the backend.
 *   - isLoading: Boolean flag — true while waiting for the backend response.
 *   - error:     Error message string (null when no error).
 *
 * =============================================================================
 */

import { useState } from "react";
import "./App.css";

function App() {
  // ─── State Declarations ──────────────────────────────────────────────────
  /**
   * `query` — Holds the current value of the search input field.
   * Updated on every keystroke via the onChange handler.
   */
  const [query, setQuery] = useState("");

  /**
   * `results` — Array of result objects returned by the backend.
   * Each object is expected to have:
   *   { "document": "filename.txt", "score": 0.85 }
   * Starts as `null` to differentiate "no search performed yet" from
   * "search performed but returned empty results" (which would be []).
   */
  const [results, setResults] = useState(null);

  /**
   * `isLoading` — When true, the UI shows a loading spinner instead of
   * results.  This provides visual feedback so the user knows their
   * search request is being processed.
   */
  const [isLoading, setIsLoading] = useState(false);

  /**
   * `error` — Holds an error message string when something goes wrong.
   * When null, no error is displayed.  We clear it at the start of each
   * new search to remove stale error messages.
   */
  const [error, setError] = useState(null);

  // ─── Search Handler ──────────────────────────────────────────────────────

  /**
   * handleSearch — Triggered when the user submits the search form.
   *
   * This function orchestrates the entire search flow:
   *   1. Prevents the default form submission (which would reload the page).
   *   2. Validates the query (rejects empty/whitespace-only input).
   *   3. Sets loading state to show the spinner.
   *   4. Sends a POST request to the backend API.
   *   5. Processes the response and updates state accordingly.
   *   6. Catches and displays any errors that occur.
   *
   * @param {Event} e — The form submission event.
   */
  const handleSearch = async (e) => {
    // Step 1: Prevent the browser from performing a full page reload,
    // which is the default behavior for form submissions.
    e.preventDefault();

    // Step 2: Don't send empty queries to the backend — trim whitespace
    // and check that something remains.
    if (!query.trim()) return;

    // Step 3: Reset previous state and activate the loading indicator.
    // We clear any previous error and results so the UI is clean while
    // the new search is processing.
    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      /**
       * Step 4: Send the search query to the Express backend.
       *
       * ENDPOINT: POST /api/search
       * BODY:     { "query": "<user's search terms>" }
       *
       * During development, Vite's proxy (configured in vite.config.js)
       * forwards requests to "/api/*" to http://localhost:5000 where
       * the Express server is running.
       *
       * The Express server will:
       *   a) Extract the query from the request body.
       *   b) Execute the C++ engine binary with the query as an argument.
       *   c) Capture the engine's stdout output (a JSON array).
       *   d) Parse and return the results.
       */
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: query.trim() }),
      });

      /**
       * Parse the JSON response body.
       * The backend always returns an object with:
       *   { "success": true/false, "results": [...] or "error": "..." }
       */
      const data = await response.json();

      /**
       * Step 5: Check if the backend reported an error.
       *
       * Even if the HTTP status is 200, the backend may set success=false
       * if the engine returned invalid output.  More commonly, the backend
       * returns 400/500 status codes for errors, and `response.ok` will
       * be false.
       */
      if (!response.ok || !data.success) {
        // Use the error message from the backend, or fall back to a
        // generic message if none was provided.
        setError(data.error || "An unexpected error occurred.");
        setResults(null);
      } else {
        /**
         * Step 6: Success! Store the results array in state.
         * React will re-render the component and display the result cards.
         *
         * Each result object from the C++ engine typically contains:
         *   - document: The filename/path of the matching document
         *   - score:    The term frequency (TF) score as a number
         */
        setResults(data.results);
      }
    } catch (err) {
      /**
       * Step 7: Network or parsing error.
       *
       * This catch block handles cases where:
       *   - The backend server is not running (connection refused)
       *   - The network is down
       *   - The response body is not valid JSON
       *
       * We log the full error for debugging and show a user-friendly
       * message in the UI.
       */
      console.error("[SEARCH ERROR]", err);
      setError(
        "Could not connect to the search server. Please make sure the backend is running on port 5000."
      );
      setResults(null);
    } finally {
      /**
       * Whether the request succeeded or failed, we always turn off the
       * loading indicator.  `finally` guarantees this runs regardless of
       * whether the try block threw an error.
       */
      setIsLoading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* ── Header Section ─────────────────────────────────────────────── */}
      <header className="header">
        <span className="header__icon" role="img" aria-label="search">
          🔍
        </span>
        <h1 className="header__title">Simple Search Engine</h1>
        <p className="header__subtitle">
          Enter a query below to search through the document corpus. Results are
          ranked by term frequency.
        </p>
      </header>

      {/* ── Search Form ────────────────────────────────────────────────── */}
      {/**
       * We use a <form> element so that pressing Enter in the input field
       * also triggers the search (via the onSubmit handler), in addition
       * to clicking the "Search" button.
       */}
      <form className="search-form" onSubmit={handleSearch}>
        <div className="search-bar">
          <input
            type="text"
            className="search-bar__input"
            placeholder="Search documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search query"
            autoFocus
          />
          <button
            type="submit"
            className="search-bar__button"
            disabled={isLoading || !query.trim()}
          >
            {/**
             * The button text changes based on loading state to give
             * the user clear feedback about what's happening.
             */}
            {isLoading ? (
              <>⏳ Searching...</>
            ) : (
              <>🔎 Search</>
            )}
          </button>
        </div>
      </form>

      {/* ── Loading State ──────────────────────────────────────────────── */}
      {/**
       * When `isLoading` is true, show a spinning animation and text.
       * This provides visual feedback while the backend is executing
       * the C++ engine (which could take a few seconds for large corpora).
       */}
      {isLoading && (
        <div className="loading">
          <div className="spinner"></div>
          <p className="loading__text">
            Searching through documents...
          </p>
        </div>
      )}

      {/* ── Error State ────────────────────────────────────────────────── */}
      {/**
       * If `error` is non-null, display the error message in a prominently
       * styled error box.  Common errors include:
       *   - "Search engine binary not found" (engine.exe missing)
       *   - "Search engine timed out" (query took too long)
       *   - "Could not connect to the search server" (backend not running)
       */}
      {error && (
        <div className="error">
          <span className="error__icon">⚠️</span>
          <p className="error__text">{error}</p>
        </div>
      )}

      {/* ── Search Results ─────────────────────────────────────────────── */}
      {/**
       * We check three different states:
       *   1. results !== null && results.length > 0 → Show result cards
       *   2. results !== null && results.length === 0 → "No results found"
       *   3. results === null → No search performed yet (show nothing)
       */}
      {results !== null && results.length > 0 && (
        <section className="results">
          <div className="results__header">
            <h2 className="results__title">Search Results</h2>
            <span className="results__count">
              {results.length} document{results.length !== 1 ? "s" : ""} found
            </span>
          </div>

          <div className="results__list">
            {/**
             * Map over the results array and render a card for each.
             *
             * Each result object from the C++ engine has:
             *   - document: The name/path of the matching document
             *   - score:    The term frequency score (a float)
             *
             * The `style` prop adds a staggered animation delay so cards
             * appear one after another (0ms, 50ms, 100ms, ...) for a
             * polished cascading effect.
             */}
            {results.map((result, index) => (
              <div
                className="result-card"
                key={index}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="result-card__top">
                  {/* Rank badge — shows position (1-indexed) */}
                  <span className="result-card__rank">{index + 1}</span>

                  {/* Document name */}
                  <span className="result-card__document">
                    {result.document}
                  </span>

                  {/* Term Frequency score badge */}
                  <span className="result-card__score-badge">
                    TF: {typeof result.score === "number"
                      ? result.score.toFixed(4)
                      : result.score}
                  </span>
                </div>

                <p className="result-card__label">
                  📄 Document Match #{index + 1}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Empty Results State ────────────────────────────────────────── */}
      {results !== null && results.length === 0 && (
        <div className="empty-state">
          <span className="empty-state__icon">📭</span>
          <p className="empty-state__text">
            No documents matched your query. Try different search terms.
          </p>
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="footer">
        Simple Search Engine — University Project • C++ Engine + MERN Stack
      </footer>
    </div>
  );
}

export default App;
