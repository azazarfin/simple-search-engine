/**
 * =============================================================================
 * SERVER.JS — Node.js/Express Backend for the Simple Search Engine
 * =============================================================================
 *
 * ARCHITECTURE OVERVIEW
 * ---------------------
 * This file acts as the "bridge" between the React frontend and the compiled
 * C++ search engine executable.  The data flow is:
 *
 *   1. The React UI sends a POST request to `/api/search` with a JSON body
 *      containing the user's search query, e.g. { "query": "data structures" }.
 *
 *   2. This Express server receives the request, validates the query, and
 *      spawns the C++ binary (`engine.exe` on Windows, `./engine` on Linux)
 *      as a child process using Node's built-in `child_process.execFile`.
 *
 *   3. The search query is passed to the C++ program as a **command-line
 *      argument** (NOT via stdin).  This means the C++ main() receives it in
 *      argv[1].
 *
 *   4. The C++ engine performs its search (TF-IDF, inverted index, etc.) and
 *      prints the results to **stdout** as a JSON array, e.g.:
 *        [
 *          { "document": "file1.txt", "score": 0.85 },
 *          { "document": "file2.txt", "score": 0.42 }
 *        ]
 *
 *   5. This server captures that stdout output, parses it as JSON, and sends
 *      it back to the React frontend as the HTTP response.
 *
 * WHY execFile INSTEAD OF exec?
 * -----------------------------
 * `child_process.exec` runs the command **through a shell** (cmd.exe / bash),
 * which means a malicious query string could perform shell injection.
 * For example, a query like `"; rm -rf /"` would be catastrophic.
 *
 * `child_process.execFile` bypasses the shell entirely.  The executable path
 * and its arguments are passed directly to the OS, so special shell characters
 * in the query are treated as literal strings — NOT as shell commands.
 * This is a critical security measure for running external binaries.
 *
 * TIMEOUT
 * -------
 * We set a 10-second timeout on the child process.  If the C++ engine hangs
 * or takes too long (e.g., searching an extremely large corpus), the process
 * is killed and the user receives a timeout error.
 *
 * =============================================================================
 */

// ─── Module Imports ──────────────────────────────────────────────────────────

const express = require("express");
const cors = require("cors");
const path = require("path");
const { execFile } = require("child_process");

// ─── App Initialization ─────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * Middleware: cors()
 * ------------------
 * During development the React dev-server (Vite) runs on port 5173 while this
 * Express server runs on port 5000.  Without CORS headers the browser would
 * block cross-origin requests from the frontend to the backend.
 * `cors()` with no arguments allows requests from ANY origin — fine for a
 * local university project.  In production you would restrict this.
 */
app.use(cors());

/**
 * Middleware: express.json()
 * -------------------------
 * Parses incoming JSON request bodies so that `req.body` is a JS object.
 * This is necessary because the React frontend sends POST requests with
 * Content-Type: application/json.
 */
app.use(express.json());

// ─── Determine the Engine Binary Path ────────────────────────────────────────

/**
 * ENGINE_PATH — Absolute path to the compiled C++ search engine binary.
 *
 * We expect the compiled binary to be placed in the same directory as this
 * server file (i.e., inside the `server/` folder).
 *
 * - On Windows: `engine.exe`
 * - On Linux / macOS: `engine`
 *
 * The `process.platform` check lets the same codebase run on any OS without
 * modification — useful when team members develop on different machines.
 */
const ENGINE_FILENAME = process.platform === "win32" ? "engine.exe" : "engine";
const ENGINE_PATH = path.join(__dirname, ENGINE_FILENAME);

/**
 * EXECUTION_TIMEOUT_MS — Maximum time (in milliseconds) the C++ engine is
 * allowed to run before being forcibly terminated.
 *
 * 10 000 ms = 10 seconds.  This prevents the server from hanging indefinitely
 * if the engine enters an infinite loop or processes an extremely large dataset.
 */
const EXECUTION_TIMEOUT_MS = 10000;

// ─── API Endpoint ────────────────────────────────────────────────────────────

/**
 * POST /api/search
 * ----------------
 * Accepts: { "query": "<search terms>" }
 * Returns: { "success": true, "results": [ ... ] }
 *      or: { "success": false, "error": "<message>" }
 *
 * FULL DATA-FLOW WALKTHROUGH:
 *
 * Step 1 — The React frontend sends a POST request:
 *          fetch("/api/search", { method: "POST", body: JSON.stringify({ query }) })
 *
 * Step 2 — Express parses the JSON body (via express.json() middleware).
 *          We extract `req.body.query` and validate it.
 *
 * Step 3 — We invoke the C++ binary via `execFile`:
 *            execFile(ENGINE_PATH, [query], { timeout: 10000 }, callback)
 *          The query is the SOLE command-line argument (argv[1] in C++).
 *          Because we use execFile (not exec), the query is NOT interpreted
 *          by a shell — special characters are harmless.
 *
 * Step 4 — When the C++ process exits, Node fires the callback with:
 *            • error  — non-null if the process failed or timed out
 *            • stdout — everything the C++ program printed to standard output
 *            • stderr — everything printed to standard error (for diagnostics)
 *
 * Step 5 — We parse `stdout` as JSON.  If parsing succeeds we send the array
 *          back to the React frontend.  If it fails we return an error.
 */
app.post("/api/search", (req, res) => {
  // ── Step 2: Extract and validate the query ──────────────────────────────

  const { query } = req.body;

  /**
   * Validation: ensure the query exists and is not just whitespace.
   * Sending an empty string to the C++ engine would be pointless and could
   * cause unexpected behavior depending on how the engine handles argv[1].
   */
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: "Search query is required. Please enter a search term.",
    });
  }

  /**
   * Sanitize: trim leading/trailing whitespace from the query.
   * This ensures the C++ engine receives a clean input string.
   */
  const sanitizedQuery = query.trim();

  console.log(`[SEARCH] Received query: "${sanitizedQuery}"`);
  console.log(`[ENGINE] Executing: ${ENGINE_PATH} "${sanitizedQuery}"`);

  // ── Step 3: Spawn the C++ search engine as a child process ──────────────

  /**
   * execFile(file, args, options, callback)
   *
   * @param {string}   file     — Absolute path to the executable.
   * @param {string[]} args     — Array of command-line arguments.
   *                              Here we pass the sanitized query as a single
   *                              argument.  In the C++ main(), this appears as
   *                              argv[1].
   * @param {object}   options  — Configuration for the child process:
   *   • timeout:      Kill the process after this many ms.
   *   • maxBuffer:    Maximum bytes allowed on stdout/stderr before the
   *                   process is killed.  1 MB should be more than enough
   *                   for search results.
   *   • windowsHide:  On Windows, prevent a console window from popping up
   *                   every time the engine runs.
   * @param {function} callback — Called when the process exits (or errors).
   */
  execFile(
    ENGINE_PATH,
    [sanitizedQuery],
    {
      timeout: EXECUTION_TIMEOUT_MS,
      maxBuffer: 1024 * 1024, // 1 MB — prevents memory issues from huge output
      windowsHide: true, // Don't flash a console window on Windows
    },
    (error, stdout, stderr) => {
      // ── Step 4: Handle the child process result ───────────────────────

      /**
       * ERROR CASE 1: The process could not be spawned at all.
       * This typically means the engine binary does not exist at ENGINE_PATH,
       * or the file is not executable.  The error code will be "ENOENT"
       * (Error NO ENTity — file not found).
       */
      if (error && error.code === "ENOENT") {
        console.error(`[ENGINE ERROR] Binary not found at: ${ENGINE_PATH}`);
        return res.status(500).json({
          success: false,
          error:
            "Search engine binary not found. Please ensure 'engine.exe' (or 'engine' on Linux) is placed in the server/ directory.",
        });
      }

      /**
       * ERROR CASE 2: The process was killed because it exceeded the timeout.
       * `error.killed` is true when Node itself terminated the process.
       * `error.signal` will be "SIGTERM".
       */
      if (error && error.killed) {
        console.error(
          `[ENGINE ERROR] Process timed out after ${EXECUTION_TIMEOUT_MS}ms`
        );
        return res.status(504).json({
          success: false,
          error: `Search engine timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds. Try a simpler query.`,
        });
      }

      /**
       * ERROR CASE 3: The process exited with a non-zero exit code.
       * This means the C++ engine ran but encountered an internal error
       * (e.g., could not open the index file, segfault, assertion failure).
       * We log stderr for debugging and return a generic error to the user.
       */
      if (error) {
        console.error(`[ENGINE ERROR] Process failed:`, error.message);
        if (stderr) {
          console.error(`[ENGINE STDERR] ${stderr}`);
        }
        return res.status(500).json({
          success: false,
          error:
            "The search engine encountered an error while processing your query.",
        });
      }

      /**
       * If stderr has content but no error was thrown, log it as a warning.
       * Some programs print diagnostic info to stderr even on success.
       */
      if (stderr) {
        console.warn(`[ENGINE STDERR] ${stderr}`);
      }

      // ── Step 5: Parse the stdout output as JSON ─────────────────────

      /**
       * The C++ engine is expected to print a JSON array to stdout.
       * Each element should have at least:
       *   { "document": "filename.txt", "score": 0.85 }
       *
       * If stdout is empty, the engine found no results — which is a valid
       * outcome, not an error.  We return an empty array.
       */
      const rawOutput = stdout.trim();

      if (rawOutput.length === 0) {
        console.log("[SEARCH] Engine returned no results (empty stdout).");
        return res.json({
          success: true,
          results: [],
          message: "No results found for your query.",
        });
      }

      /**
       * Attempt to parse the raw stdout as JSON.
       * If the C++ engine printed something that isn't valid JSON (e.g.,
       * debug messages mixed in), this will throw a SyntaxError.
       */
      try {
        const results = JSON.parse(rawOutput);

        /**
         * Verify that the parsed value is actually an array.
         * If the engine printed a JSON object instead of an array, we
         * need to handle it gracefully rather than sending malformed data.
         */
        if (!Array.isArray(results)) {
          console.error(
            "[PARSE ERROR] Engine output is valid JSON but not an array."
          );
          return res.status(500).json({
            success: false,
            error:
              "Search engine returned unexpected data format (expected a JSON array).",
          });
        }

        console.log(`[SEARCH] Returning ${results.length} result(s).`);

        /**
         * SUCCESS: Send the parsed results back to the React frontend.
         * The frontend will iterate over this array and render each result
         * as a card showing the document name and term frequency score.
         */
        return res.json({
          success: true,
          results: results,
        });
      } catch (parseError) {
        /**
         * JSON parsing failed.  This usually means the C++ engine printed
         * non-JSON output (e.g., raw text, error messages, or debug logs
         * mixed with the JSON).
         *
         * We log the raw output for debugging and return a descriptive error
         * so the developer knows to check the engine's output format.
         */
        console.error("[PARSE ERROR] Failed to parse engine output as JSON.");
        console.error("[RAW OUTPUT]", rawOutput);
        return res.status(500).json({
          success: false,
          error:
            "Failed to parse search results. The engine output was not valid JSON.",
        });
      }
    }
  );
});

// ─── Health Check Endpoint ───────────────────────────────────────────────────

/**
 * GET /api/health
 * ---------------
 * A simple health-check endpoint for quick verification that the server is
 * running.  Useful when configuring proxies or load balancers, and for the
 * React frontend to check backend connectivity.
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    engine: ENGINE_FILENAME,
    timestamp: new Date().toISOString(),
  });
});

// ─── Start the Server ────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  Simple Search Engine — Backend Server`);
  console.log(`  Running on: http://localhost:${PORT}`);
  console.log(`  Engine binary: ${ENGINE_PATH}`);
  console.log(`══════════════════════════════════════════════════════\n`);
});
