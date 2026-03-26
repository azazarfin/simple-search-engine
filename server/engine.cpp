/**
 * =============================================================================
 * ENGINE.CPP — Simple Search Engine (C++ Core)
 * =============================================================================
 *
 * OVERVIEW
 * --------
 * This is the core search engine for our university project.  It is compiled
 * into a standalone executable (engine.exe) and invoked by the Node.js backend
 * whenever a user submits a search query through the React UI.
 *
 * HOW IT IS CALLED
 * ----------------
 * The Node.js backend uses `child_process.execFile` to run this binary:
 *
 *     execFile("engine.exe", ["data structures"], callback)
 *
 * So the search query arrives as argv[1] in main().  The engine searches the
 * corpus, computes relevance scores, and prints the results to stdout as a
 * JSON array.  The Node.js backend captures that stdout and sends it to the
 * React frontend.
 *
 * SEARCH ALGORITHM
 * ----------------
 * 1. **Corpus Loading**: On every invocation, the engine reads all .txt files
 *    from the `corpus/` directory (located relative to the executable).
 *
 * 2. **Tokenization**: Each document's text is split into lowercase tokens
 *    (words).  Punctuation is stripped and words are normalized to lowercase
 *    so that "Data", "DATA", and "data" all match.
 *
 * 3. **Inverted Index**: An inverted index is built in memory:
 *      word -> { document1: count, document2: count, ... }
 *    This maps each unique word to the set of documents containing it and
 *    how many times it appears in each document.
 *
 * 4. **TF (Term Frequency) Scoring**: For a given query, we tokenize the
 *    query into individual words, then for each document that contains ANY
 *    of the query words, we compute:
 *
 *      TF(term, doc) = (number of times term appears in doc)
 *                      / (total number of words in doc)
 *
 *    The final score for a document is the SUM of TF values for all query
 *    terms that appear in that document.  Documents are ranked by this
 *    combined score in descending order.
 *
 * 5. **JSON Output**: Results are printed to stdout as a JSON array:
 *      [
 *        { "document": "file1.txt", "score": 0.0523 },
 *        { "document": "file2.txt", "score": 0.0312 }
 *      ]
 *
 * COMPILATION
 * -----------
 *   g++ -std=c++11 -O2 -o engine.exe engine.cpp
 *
 * =============================================================================
 */

#include <iostream>     // std::cout, std::cerr
#include <fstream>      // std::ifstream — reading document files
#include <sstream>      // std::stringstream — parsing file contents into tokens
#include <string>       // std::string
#include <vector>       // std::vector — dynamic arrays
#include <map>          // std::map — ordered key-value pairs (for inverted index)
#include <algorithm>    // std::sort, std::transform — sorting results, lowercasing
#include <dirent.h>     // opendir, readdir, closedir — reading directory contents
#include <cstring>      // strlen — string length for file extension check
#include <iomanip>      // std::fixed, std::setprecision — formatting score output

// ─── Data Structures ────────────────────────────────────────────────────────

/**
 * Document — Represents a single text document in the corpus.
 *
 * @member filename   The name of the file (e.g., "algorithms.txt")
 * @member words      All tokens (words) in the document, lowercased
 * @member wordCount  Total number of words (used as denominator in TF calc)
 */
struct Document {
    std::string filename;
    std::vector<std::string> words;
    int wordCount;
};

/**
 * SearchResult — A single result entry to be output as JSON.
 *
 * @member document  The filename of the matching document
 * @member score     The combined TF score for all query terms
 */
struct SearchResult {
    std::string document;
    double score;
};

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * toLowercase — Converts a string to all lowercase characters.
 *
 * This ensures case-insensitive matching: a search for "Algorithm" will
 * match "algorithm", "ALGORITHM", etc.
 *
 * @param  str  The input string
 * @return      A new string with all characters in lowercase
 */
std::string toLowercase(const std::string& str) {
    std::string lower = str;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    return lower;
}

/**
 * isAlphanumeric — Checks if a character is a letter or digit.
 *
 * Used during tokenization to strip punctuation from words.
 * For example, "hello," becomes "hello" and "(data)" becomes "data".
 *
 * @param  c  The character to check
 * @return    true if c is a letter (a-z, A-Z) or digit (0-9)
 */
bool isAlphanumeric(char c) {
    return (c >= 'a' && c <= 'z') ||
           (c >= 'A' && c <= 'Z') ||
           (c >= '0' && c <= '9');
}

/**
 * cleanWord — Strips non-alphanumeric characters from the start and end
 * of a word, then converts it to lowercase.
 *
 * Examples:
 *   "Hello,"   -> "hello"
 *   "(world)"  -> "world"
 *   "---"      -> ""  (empty, will be skipped)
 *   "it's"     -> "it's"  (internal punctuation preserved)
 *
 * @param  word  The raw token to clean
 * @return       The cleaned, lowercased token (may be empty)
 */
std::string cleanWord(const std::string& word) {
    // Find the first alphanumeric character from the left
    int start = 0;
    while (start < (int)word.size() && !isAlphanumeric(word[start])) {
        start++;
    }

    // Find the last alphanumeric character from the right
    int end = (int)word.size() - 1;
    while (end >= 0 && !isAlphanumeric(word[end])) {
        end--;
    }

    // If no alphanumeric characters were found, return empty string
    if (start > end) {
        return "";
    }

    // Extract the cleaned substring and convert to lowercase
    return toLowercase(word.substr(start, end - start + 1));
}

/**
 * tokenize — Splits a raw text string into a vector of cleaned, lowercase tokens.
 *
 * The tokenization process:
 *   1. Use stringstream to split by whitespace
 *   2. Clean each token (strip punctuation, lowercase)
 *   3. Skip empty tokens (pure punctuation words)
 *
 * @param  text  The raw text content of a document or query
 * @return       A vector of cleaned tokens
 */
std::vector<std::string> tokenize(const std::string& text) {
    std::vector<std::string> tokens;
    std::stringstream ss(text);
    std::string word;

    while (ss >> word) {
        std::string cleaned = cleanWord(word);
        if (!cleaned.empty()) {
            tokens.push_back(cleaned);
        }
    }

    return tokens;
}

/**
 * endsWith — Checks if a string ends with a given suffix.
 *
 * Used to filter directory entries — we only want .txt files from the corpus.
 *
 * @param  str     The string to check
 * @param  suffix  The suffix to look for
 * @return         true if str ends with suffix
 */
bool endsWith(const std::string& str, const std::string& suffix) {
    if (suffix.size() > str.size()) return false;
    return str.compare(str.size() - suffix.size(), suffix.size(), suffix) == 0;
}

/**
 * readFile — Reads the entire contents of a file into a string.
 *
 * @param  filepath  The path to the file
 * @return           The file contents as a single string, or empty if read failed
 */
std::string readFile(const std::string& filepath) {
    std::ifstream file(filepath.c_str());
    if (!file.is_open()) {
        std::cerr << "[ENGINE WARNING] Could not open file: " << filepath << std::endl;
        return "";
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

/**
 * loadCorpus — Reads all .txt files from the specified directory.
 *
 * This function:
 *   1. Opens the corpus directory using POSIX opendir/readdir
 *   2. Filters for files ending in ".txt"
 *   3. Reads each file's content
 *   4. Tokenizes the content into lowercase words
 *   5. Stores the result as a Document struct
 *
 * @param  dirPath  Path to the corpus directory
 * @return          A vector of Document structs, one per .txt file
 */
std::vector<Document> loadCorpus(const std::string& dirPath) {
    std::vector<Document> documents;

    DIR* dir = opendir(dirPath.c_str());
    if (dir == NULL) {
        std::cerr << "[ENGINE ERROR] Could not open corpus directory: " << dirPath << std::endl;
        return documents;
    }

    struct dirent* entry;
    while ((entry = readdir(dir)) != NULL) {
        std::string filename = entry->d_name;

        // Skip "." and ".." directories, and non-.txt files
        if (filename == "." || filename == "..") continue;
        if (!endsWith(filename, ".txt")) continue;

        // Read the file contents
        std::string filepath = dirPath + "/" + filename;
        std::string content = readFile(filepath);

        if (content.empty()) continue;

        // Tokenize the document content
        Document doc;
        doc.filename = filename;
        doc.words = tokenize(content);
        doc.wordCount = (int)doc.words.size();

        // Only add documents that have at least one word
        if (doc.wordCount > 0) {
            documents.push_back(doc);
        }
    }

    closedir(dir);
    return documents;
}

// ─── Inverted Index ──────────────────────────────────────────────────────────

/**
 * InvertedIndex — Maps each unique word to the documents it appears in and
 * how many times it appears in each document.
 *
 * Structure:
 *   word -> { docIndex1: count1, docIndex2: count2, ... }
 *
 * For example, after indexing two documents:
 *   "algorithm" -> { 0: 3, 2: 1 }   // appears 3x in doc 0, 1x in doc 2
 *   "data"      -> { 0: 2, 1: 5 }   // appears 2x in doc 0, 5x in doc 1
 *
 * We use document indices (into the documents vector) rather than filenames
 * to avoid repeated string comparisons during search.
 */
typedef std::map<std::string, std::map<int, int>> InvertedIndex;

/**
 * buildInvertedIndex — Constructs the inverted index from the loaded corpus.
 *
 * For each document, we iterate through all its tokens and record:
 *   index[token][docIndex]++
 *
 * This gives us O(1) lookup of which documents contain a given word and
 * how many times it appears in each.
 *
 * @param  documents  The corpus (vector of Document structs)
 * @return            The constructed inverted index
 */
InvertedIndex buildInvertedIndex(const std::vector<Document>& documents) {
    InvertedIndex index;

    for (int i = 0; i < (int)documents.size(); i++) {
        const Document& doc = documents[i];
        for (int j = 0; j < (int)doc.words.size(); j++) {
            // Increment the count for this word in this document
            index[doc.words[j]][i]++;
        }
    }

    return index;
}

// ─── Search Function ─────────────────────────────────────────────────────────

/**
 * search — Performs a TF-based search across the corpus.
 *
 * ALGORITHM:
 *   1. Tokenize the query string into individual words.
 *   2. For each query word, look it up in the inverted index.
 *   3. For each document that contains the word, compute:
 *        TF(word, doc) = occurrences_of_word_in_doc / total_words_in_doc
 *   4. Sum the TF scores for all query words per document.
 *   5. Sort documents by their total score in descending order.
 *   6. Return the top results.
 *
 * WHY TERM FREQUENCY (TF)?
 *   TF measures how important a word is within a specific document.
 *   A document where "algorithm" appears 10 times out of 100 words (TF=0.10)
 *   is more relevant for the query "algorithm" than a document where it
 *   appears 1 time out of 500 words (TF=0.002).
 *
 * @param  queryStr   The raw query string from the user
 * @param  documents  The corpus documents
 * @param  index      The pre-built inverted index
 * @return            A sorted vector of SearchResult structs
 */
std::vector<SearchResult> search(
    const std::string& queryStr,
    const std::vector<Document>& documents,
    const InvertedIndex& index
) {
    // Step 1: Tokenize the query
    std::vector<std::string> queryTerms = tokenize(queryStr);

    if (queryTerms.empty()) {
        return std::vector<SearchResult>();  // No valid query terms
    }

    // Step 2-3: Accumulate TF scores per document
    // We use a map: docIndex -> accumulated TF score
    std::map<int, double> scores;

    for (int q = 0; q < (int)queryTerms.size(); q++) {
        const std::string& term = queryTerms[q];

        // Look up the term in the inverted index
        InvertedIndex::const_iterator it = index.find(term);
        if (it == index.end()) {
            // This query term doesn't appear in any document — skip it
            continue;
        }

        // Iterate over all documents that contain this term
        const std::map<int, int>& docEntries = it->second;
        for (std::map<int, int>::const_iterator docIt = docEntries.begin();
             docIt != docEntries.end(); ++docIt) {

            int docIndex = docIt->first;
            int termCount = docIt->second;

            /**
             * Compute Term Frequency (TF):
             *   TF = (number of times the term appears in the document)
             *      / (total number of words in the document)
             *
             * This normalizes the count by document length so that longer
             * documents don't automatically score higher just because they
             * have more words.
             */
            double tf = (double)termCount / (double)documents[docIndex].wordCount;

            // Add this term's TF to the document's total score
            scores[docIndex] += tf;
        }
    }

    // Step 4: Convert the scores map into a vector of SearchResult structs
    std::vector<SearchResult> results;
    for (std::map<int, double>::iterator it = scores.begin();
         it != scores.end(); ++it) {
        SearchResult result;
        result.document = documents[it->first].filename;
        result.score = it->second;
        results.push_back(result);
    }

    // Step 5: Sort results by score in descending order (highest first)
    // We use a simple lambda-like comparison (C++11 compatible)
    for (int i = 0; i < (int)results.size() - 1; i++) {
        for (int j = i + 1; j < (int)results.size(); j++) {
            if (results[j].score > results[i].score) {
                SearchResult temp = results[i];
                results[i] = results[j];
                results[j] = temp;
            }
        }
    }

    return results;
}

// ─── JSON Output ─────────────────────────────────────────────────────────────

/**
 * escapeJSON — Escapes special characters in a string for safe JSON output.
 *
 * JSON requires that backslashes and double quotes inside string values
 * are escaped.  Without this, a filename like `my"file.txt` would produce
 * invalid JSON.
 *
 * @param  str  The raw string to escape
 * @return      The escaped string safe for embedding in JSON
 */
std::string escapeJSON(const std::string& str) {
    std::string escaped;
    for (int i = 0; i < (int)str.size(); i++) {
        char c = str[i];
        if (c == '"') {
            escaped += "\\\"";
        } else if (c == '\\') {
            escaped += "\\\\";
        } else if (c == '\n') {
            escaped += "\\n";
        } else if (c == '\r') {
            escaped += "\\r";
        } else if (c == '\t') {
            escaped += "\\t";
        } else {
            escaped += c;
        }
    }
    return escaped;
}

/**
 * printResultsAsJSON — Prints the search results to stdout as a JSON array.
 *
 * This is the OUTPUT CONTRACT with the Node.js backend.  The backend expects
 * the engine to print exactly one JSON array to stdout:
 *
 *   [
 *     { "document": "filename.txt", "score": 0.0523 },
 *     { "document": "another.txt",  "score": 0.0312 }
 *   ]
 *
 * The Node.js backend captures this stdout, parses it with JSON.parse(),
 * and forwards the array to the React frontend.
 *
 * IMPORTANT: No other text should be printed to stdout (use stderr for
 * diagnostics).  Any non-JSON output on stdout will cause JSON.parse() to
 * fail in the Node.js backend.
 *
 * @param  results  The sorted search results to output
 */
void printResultsAsJSON(const std::vector<SearchResult>& results) {
    std::cout << "[" << std::endl;

    for (int i = 0; i < (int)results.size(); i++) {
        std::cout << "  {";
        std::cout << "\"document\": \"" << escapeJSON(results[i].document) << "\", ";
        std::cout << std::fixed << std::setprecision(6);
        std::cout << "\"score\": " << results[i].score;
        std::cout << "}";

        // Print a comma after every result except the last one
        if (i < (int)results.size() - 1) {
            std::cout << ",";
        }
        std::cout << std::endl;
    }

    std::cout << "]" << std::endl;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * main — Entry point of the search engine.
 *
 * INVOCATION:
 *   engine.exe "search query here"
 *
 * The search query is received as argv[1].  This is how the Node.js backend
 * passes the user's query to this program (via child_process.execFile).
 *
 * EXECUTION FLOW:
 *   1. Validate command-line arguments
 *   2. Load all .txt documents from the corpus/ directory
 *   3. Build the inverted index
 *   4. Perform the search using TF scoring
 *   5. Print results as JSON to stdout
 *
 * EXIT CODES:
 *   0 — Success (results printed, even if empty)
 *   1 — Error (no query provided, corpus empty, etc.)
 */
int main(int argc, char* argv[]) {
    // ── Step 1: Validate command-line arguments ──────────────────────────

    if (argc < 2) {
        /**
         * No query was provided.  Print an error to stderr (NOT stdout,
         * because stdout is reserved for JSON output).
         *
         * The Node.js backend checks for non-zero exit codes and reports
         * errors to the user.
         */
        std::cerr << "[ENGINE ERROR] Usage: engine.exe <search query>" << std::endl;
        // Print empty JSON array so the backend still gets valid JSON
        std::cout << "[]" << std::endl;
        return 1;
    }

    // The query arrives as argv[1] — a single string even if it has spaces,
    // because the Node.js backend passes it as one array element.
    std::string query = argv[1];

    // Diagnostic output goes to stderr (invisible to JSON parser)
    std::cerr << "[ENGINE] Received query: \"" << query << "\"" << std::endl;

    // ── Step 2: Load the corpus from the corpus/ directory ───────────────

    /**
     * CORPUS_DIR — Path to the directory containing .txt document files.
     *
     * We use a relative path "corpus" which means the directory must be
     * located in the same folder where engine.exe is run from.  Since the
     * Node.js backend runs execFile from the server/ directory, the corpus/
     * folder should be at: server/corpus/
     */
    std::string corpusDir = "corpus";

    std::cerr << "[ENGINE] Loading corpus from: " << corpusDir << "/" << std::endl;

    std::vector<Document> documents = loadCorpus(corpusDir);

    if (documents.empty()) {
        std::cerr << "[ENGINE WARNING] No documents found in corpus directory." << std::endl;
        std::cerr << "[ENGINE WARNING] Make sure .txt files exist in: " << corpusDir << "/" << std::endl;
        // Return empty results (valid JSON), not an error
        std::cout << "[]" << std::endl;
        return 0;
    }

    std::cerr << "[ENGINE] Loaded " << documents.size() << " document(s)." << std::endl;

    // ── Step 3: Build the inverted index ─────────────────────────────────

    std::cerr << "[ENGINE] Building inverted index..." << std::endl;

    InvertedIndex index = buildInvertedIndex(documents);

    std::cerr << "[ENGINE] Index contains " << index.size() << " unique terms." << std::endl;

    // ── Step 4: Perform the search ───────────────────────────────────────

    std::cerr << "[ENGINE] Searching for: \"" << query << "\"" << std::endl;

    std::vector<SearchResult> results = search(query, documents, index);

    std::cerr << "[ENGINE] Found " << results.size() << " matching document(s)." << std::endl;

    // ── Step 5: Output results as JSON to stdout ─────────────────────────

    /**
     * This is the critical output step.  The JSON printed here is captured
     * by the Node.js backend via the child process's stdout stream and then
     * forwarded to the React frontend.
     *
     * The contract:
     *   - stdout: ONLY the JSON array (no other text!)
     *   - stderr: Diagnostic messages (captured by Node but not sent to UI)
     */
    printResultsAsJSON(results);

    return 0;
}
