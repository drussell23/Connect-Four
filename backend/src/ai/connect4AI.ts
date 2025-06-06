// src/ai/connect4AI.ts
import { performance } from "perf_hooks";
import { quiesce } from "./quiescence";

// 1) A 6 × 7 heatmap: central & lower cells matter most
const CELL_WEIGHTS: number[][] = [
  [3, 4, 5, 7, 5, 4, 3],
  [4, 6, 8, 10, 8, 6, 4],
  [5, 8, 11, 13, 11, 8, 5],
  [5, 8, 11, 13, 11, 8, 5],
  [4, 6, 8, 10, 8, 6, 4],
  [3, 4, 5, 7, 5, 4, 3],
];

// 2) Weight for opponent's connection potential (so we subtract it).
const OPP_CONN_POT_WEIGHT = 0.8;

// 3) Two-step fork penalty per threat.
const TWO_STEP_FORK_WEIGHT = 4000;

/** Valid values for each cell in the Connect 4 grid **/
export type CellValue = 'Empty' | 'Red' | 'Yellow';

/** Rich move info for ordering and pruning. **/
export interface Move {
  col: number;
  row: number;
  isWinning: boolean;
  isBlocking: boolean;
  futureThreats: number;
  score: number;
}

/**
 * Compute the row index where a disc would land if dropped in the given column.
 * Returns null if the column is already full or on any error/invalid input.
 */
export function getDropRow(
  board: CellValue[][],
  col: number
): number | null {
  try {
    console.debug(`[getDropRow] called with col=${col}`);

    // --- Validate board ---
    if (
      !Array.isArray(board) ||
      board.length === 0 ||
      !Array.isArray(board[0])
    ) {
      console.error('[getDropRow] invalid board structure:', board);
      return null;
    }

    const ROWS = board.length;
    const COLS = board[0].length;

    // --- Validate column index ---
    if (!Number.isInteger(col) || col < 0 || col >= COLS) {
      console.error(`[getDropRow] column ${col} out of bounds (0–${COLS - 1})`);
      return null;
    }

    // --- Find the lowest empty cell in that column ---
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r][col] === 'Empty') {
        console.debug(`[getDropRow] dropping into row=${r}, col=${col}`);
        return r;
      }
    }

    // Column is full
    console.debug(`[getDropRow] column ${col} is full`);
    return null;

  } catch (err) {
    // Catch anything unexpected and fail safely
    console.error('[getDropRow] unexpected error:', err);
    return null;
  }
}


/**
 * Returns moves sorted by a composite strategic score:
 * 1) Immediate win
 * 2) Immediate block
 * 3) Static board evaluation after move
 * 4) Penalty for handing off opponent forks
 * 5) Center‐column bias
 */
export function orderedMoves(
  board: CellValue[][],
  currentPlayer: CellValue
): Move[] {
  const COLS = board[0].length;
  const center = Math.floor(COLS / 2);
  const opponent: CellValue = currentPlayer === 'Red' ? 'Yellow' : 'Red';

  // 1) Gather all legal moves
  const cols = legalMoves(board);

  const moves: Move[] = cols.map(col => {
    const row = getDropRow(board, col)!;
    // simulate drop
    const { board: afterUs } = tryDrop(board, col, currentPlayer);
    const { board: afterOppSim } = tryDrop(board, col, opponent);

    // 2) Tactical flags
    const isWinning = bitboardCheckWin(getBits(afterUs, currentPlayer));
    const isBlocking = bitboardCheckWin(getBits(afterOppSim, opponent));

    // 3) Positional score
    const posScore = evaluateBoard(afterUs, currentPlayer);

    // 4) Future threat penalty
    //   count how many forks the opponent will have after *our* move
    const futureThreats = countOpenThree(afterUs, opponent);

    // 5) Center bias
    const centerBonus = Math.max(0, 5 - Math.abs(col - center));

    // Composite:
    //  - Immediate win: +1e6
    //  - Immediate block: +1e5
    //  - Then positional minus big penalty per futureThreat
    const score =
      (isWinning ? 1e6 : 0) +
      (isBlocking ? 1e5 : 0) +
      posScore -
      futureThreats * 1e4 +
      centerBonus * 100;

    return { col, row, score, isWinning, isBlocking, futureThreats };
  });

  // 6) Sort by descending composite score
  return moves.sort((a, b) => b.score - a.score);
}

/** Returns an array of column indices (0–6) that are not full. **/
export function legalMoves(board: CellValue[][]): number[] {
  const cols = board[0].length;
  return Array.from({ length: cols }, (_, c) => c).filter(
    (c) => board[0][c] === 'Empty'
  );
}

/** Drops a disc in the given column, returning the new board and the row index. **/
export function tryDrop(
  board: CellValue[][],
  column: number,
  disc: CellValue
): { board: CellValue[][]; row: number } {
  const newBoard = board.map((row) => [...row]);
  for (let r = newBoard.length - 1; r >= 0; r--) {
    if (newBoard[r][column] === 'Empty') {
      newBoard[r][column] = disc;
      return { board: newBoard, row: r };
    }
  }
  throw new Error(`Column ${column} is full`);
}

/** Bitboard utilities **/
export function boardToBitboards(board: CellValue[][]): { red: bigint; yellow: bigint } {
  let red = 0n;
  let yellow = 0n;
  const COLS = BigInt(board[0].length);
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const idx = BigInt(r) * COLS + BigInt(c);
      if (board[r][c] === 'Red') red |= 1n << idx;
      else if (board[r][c] === 'Yellow') yellow |= 1n << idx;
    }
  }
  return { red, yellow };
}

/** Helper to pick the correct bitboard for a disc **/
export function getBits(board: CellValue[][], disc: CellValue): bigint {
  const { red, yellow } = boardToBitboards(board);
  return disc === 'Red' ? red : yellow;
}

export function bitboardCheckWin(bb: bigint): boolean {
  // horizontal
  let m = bb & (bb >> 1n);
  if ((m & (m >> 2n)) !== 0n) return true;
  // vertical
  m = bb & (bb >> 7n);
  if ((m & (m >> (14n))) !== 0n) return true;
  // diag down-right
  m = bb & (bb >> 8n);
  if ((m & (m >> (16n))) !== 0n) return true;
  // diag down-left
  m = bb & (bb >> 6n);
  if ((m & (m >> (12n))) !== 0n) return true;
  return false;
}

/** Static board evaluation **/
const WINDOW = 4;
const BASE_SCORES: Record<number, number> = { 4: 100, 3: 5, 2: 2 };
const OPEN_THREE_BONUS = { bothEnds: 4, oneEnd: 2 };
const CENTER_COLUMN_BONUS = 3;
const TOP_ROW_PENALTY_FACTOR = 0.8;

/** Static board evaluation for one 4-cell window, with logging & safety. **/
export function evaluateWindow(
  cells: CellValue[],
  aiDisc: CellValue
): number {
  try {
    const humanDisc = aiDisc === 'Red' ? 'Yellow' : 'Red';
    const aiCount = cells.filter(c => c === aiDisc).length;
    const humanCount = cells.filter(c => c === humanDisc).length;
    const emptyCount = cells.filter(c => c === 'Empty').length;

    console.debug(`[evaluateWindow] cells=${JSON.stringify(cells)} aiCount=${aiCount} humanCount=${humanCount} emptyCount=${emptyCount}`);

    // 1) Immediate four-in-a-row
    if (aiCount === 4) {
      console.info(`[evaluateWindow] found AI connect-4! Window=${cells}`);
      return 1e6;
    }
    if (humanCount === 4) {
      console.info(`[evaluateWindow] found human connect-4! Window=${cells}`);
      return -1e6;
    }

    let score = 0;

    // 2) Open-three pattern (3 + 1 empty)
    if (aiCount === 3 && emptyCount === 1) {
      const ends = (cells[0] === 'Empty' ? 1 : 0) + (cells[3] === 'Empty' ? 1 : 0);
      const bonus = ends === 2 ? OPEN_THREE_BONUS.bothEnds * 20 : OPEN_THREE_BONUS.oneEnd * 10;
      console.debug(`[evaluateWindow] AI open-three (${ends === 2 ? 'bothEnds' : 'oneEnd'}) => +${bonus}`);
      score += BASE_SCORES[3] + bonus;
    }

    if (humanCount === 3 && emptyCount === 1) {
      const ends = (cells[0] === 'Empty' ? 1 : 0) + (cells[3] === 'Empty' ? 1 : 0);
      const penalty = ends === 2 ? OPEN_THREE_BONUS.bothEnds * 25 : OPEN_THREE_BONUS.oneEnd * 15;
      console.debug(`[evaluateWindow] Human open-three (${ends === 2 ? 'bothEnds' : 'oneEnd'}) => -${penalty}`);
      score -= BASE_SCORES[3] * 1.5 + penalty;
    }

    // 3) Two-in-a-row with two empties: building threats
    if (aiCount === 2 && emptyCount === 2) {
      const add = BASE_SCORES[2] * 1.2;
      console.debug(`[evaluateWindow] AI two-in-a-row => +${add}`);
      score += add;
    }

    if (humanCount === 2 && emptyCount === 2) {
      const sub = BASE_SCORES[2] * 1.8;
      console.debug(`[evaluateWindow] Human two-in-a-row => -${sub}`);
      score -= sub;
    }

    // 4) Center‐cell bonus/penalty within this window
    const centerIdx = Math.floor(cells.length / 2);
    if (cells[centerIdx] === aiDisc) {
      console.debug(`[evaluateWindow] center bonus +${CENTER_COLUMN_BONUS}`);
      score += CENTER_COLUMN_BONUS;
    }
    if (cells[centerIdx] === humanDisc) {
      console.debug(`[evaluateWindow] center penalty -${CENTER_COLUMN_BONUS}`);
      score -= CENTER_COLUMN_BONUS;
    }

    console.debug(`[evaluateWindow] final score=${score} for window=${JSON.stringify(cells)}`);
    return score;

  } catch (err) {
    console.error('[evaluateWindow] error evaluating window', cells, err);
    // fail safe: no bias
    return 0;
  }
}

const DOUBLE_FORK_PENALTY = 1e7;
const SINGLE_FORK_PENALTY = 1e6;

/**
 * For every 4-cell “window” in all directions:
 *   - if there are 0 opponent discs, add (myCount²) * WEIGHT
 */
function evaluateConnectionPotential(
  board: CellValue[][],
  aiDisc: CellValue
): number {
  const humanDisc = aiDisc === 'Red' ? 'Yellow' : 'Red';
  let total = 0;

  const addWindow = (cells: CellValue[]) => {
    const myCount = cells.filter(c => c === aiDisc).length;
    const oppCount = cells.filter(c => c === humanDisc).length;

    if (oppCount === 0 && myCount > 0) {
      total += (myCount * myCount) * 10;
    }
  };

  const R = board.length, C = board[0].length, W = 4;

  // Horizontal 
  for (let r = 0; r < R; r++) {
    for (let c = 0; c <= C - W; c++) {
      addWindow(board[r].slice(c, c + W));
    }
  }

  // Vertical 
  for (let c = 0; c < C; c++) {
    for (let r = 0; r <= R - W; r++) {
      addWindow([0, 1, 2, 3].map(i => board[r + i][c]));
    }
  }

  // Diagonals ↘
  for (let r = 0; r <= R - W; r++) {
    for (let c = 0; c <= C - W; c++) {
      addWindow([0, 1, 2, 3].map(i => board[r + i][c + i]));
    }
  }

  // Diagonals ↙
  for (let r = 0; r <= R - W; r++) {
    for (let c = W - 1; c < C; c++) {
      addWindow([0, 1, 2, 3].map(i => board[r + i][c - i]));
    }
  }

  return total;
}

/**
 * Count how many forced‐forks you can set up in two moves:
 * for each legal drop, assume opponent blocks your best threat,
 * then see if you can still create ≥1 open-three. 
 */
function countTwoStepForks(
  board: CellValue[][],
  aiDisc: CellValue,
  timeMs = 0  // or ignore timing here
): number {
  const opp = aiDisc === 'Red' ? 'Yellow' : 'Red';
  let forks = 0;
  for (const col of legalMoves(board)) {
    // 1) I drop
    const { board: b1 } = tryDrop(board, col, aiDisc);
    // 2) Opponent counters my strongest immediate fork
    const block = findOpenThreeBlock(b1, aiDisc);
    const b2 = block !== null
      ? tryDrop(b1, block, opp).board
      : b1;
    // 3) Now do I have any open-three?
    if (countOpenThree(b2, aiDisc) > 0) {
      forks++;
    }
  }
  return forks;
}

/** New helper: Raw cell-control score. */
function evaluateCellControl(
  board: CellValue[][],
  aiDisc: CellValue
): number {
  const rows = board.length;
  const cols = board[0].length;
  const humanDisc = aiDisc === 'Red' ? 'Yellow' : 'Red';
  let s = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === aiDisc)
        s += CELL_WEIGHTS[r][c];
      else if (board[r][c] === humanDisc)
        s -= CELL_WEIGHTS[r][c];
    }
  }
  return s;
}

// You may want to bump this to match your DOUBLE_FORK_PENALTY scale:
const IMMEDIATE_THREAT_PENALTY = 1_000_000;

export function evaluateBoard(
  board: CellValue[][],
  aiDisc: CellValue
): number {
  const rows = board.length;
  const cols = board[0].length;
  const humanDisc = aiDisc === 'Red' ? 'Yellow' : 'Red';

  // ── 1) Double-fork doom
  const humanForks = countOpenThree(board, humanDisc);
  if (humanForks >= 2) {
    return -DOUBLE_FORK_PENALTY;
  }
  // ── 2) Single-fork penalty
  if (humanForks === 1) {
    return -SINGLE_FORK_PENALTY;
  }

  // ── 3) Immediate open-three threat (any direction!) ─────────────
  // Horizontal
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols - WINDOW; c++) {
      const w = board[r].slice(c, c + WINDOW);
      if (
        w.filter(x => x === humanDisc).length === 3 &&
        w.filter(x => x === 'Empty').length === 1
      ) {
        return -IMMEDIATE_THREAT_PENALTY;
      }
    }
  }
  // Vertical
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r <= rows - WINDOW; r++) {
      const w = [0, 1, 2, 3].map(i => board[r + i][c]);
      if (
        w.filter(x => x === humanDisc).length === 3 &&
        w.filter(x => x === 'Empty').length === 1
      ) {
        return -IMMEDIATE_THREAT_PENALTY;
      }
    }
  }
  // Diagonal down-right
  for (let r = 0; r <= rows - WINDOW; r++) {
    for (let c = 0; c <= cols - WINDOW; c++) {
      const w = [0, 1, 2, 3].map(i => board[r + i][c + i]);
      if (
        w.filter(x => x === humanDisc).length === 3 &&
        w.filter(x => x === 'Empty').length === 1
      ) {
        return -IMMEDIATE_THREAT_PENALTY;
      }
    }
  }
  // Diagonal down-left
  for (let r = 0; r <= rows - WINDOW; r++) {
    for (let c = WINDOW - 1; c < cols; c++) {
      const w = [0, 1, 2, 3].map(i => board[r + i][c - i]);
      if (
        w.filter(x => x === humanDisc).length === 3 &&
        w.filter(x => x === 'Empty').length === 1
      ) {
        return -IMMEDIATE_THREAT_PENALTY;
      }
    }
  }

  // ── 4) Positional scan (windows) ───────────────────────────────
  let score = 0;

  // Horizontal windows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols - WINDOW; c++) {
      const w = board[r].slice(c, c + WINDOW);
      score +=
        evaluateWindow(w, aiDisc) *
        (r === 0 ? TOP_ROW_PENALTY_FACTOR : 1);
    }
  }

  // Vertical windows
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r <= rows - WINDOW; r++) {
      const w = [0, 1, 2, 3].map(i => board[r + i][c]);
      score +=
        evaluateWindow(w, aiDisc) *
        (r === 0 ? TOP_ROW_PENALTY_FACTOR : 1);
    }
  }

  // Diagonal windows
  for (let r = 0; r <= rows - WINDOW; r++) {
    for (let c = 0; c <= cols - WINDOW; c++) {
      const dr = [0, 1, 2, 3].map(i => board[r + i][c + i]);
      score +=
        evaluateWindow(dr, aiDisc) *
        (r === 0 ? TOP_ROW_PENALTY_FACTOR : 1);

      const dl = [0, 1, 2, 3].map(i => board[r + i][c + WINDOW - 1 - i]);
      score +=
        evaluateWindow(dl, aiDisc) *
        (r === 0 ? TOP_ROW_PENALTY_FACTOR : 1);
    }
  }

  // Center‐column bonus/penalty
  const center = Math.floor(cols / 2);
  for (let r = 0; r < rows; r++) {
    if (board[r][center] === aiDisc) score += CENTER_COLUMN_BONUS;
    else if (board[r][center] === humanDisc)
      score -= CENTER_COLUMN_BONUS;
  }

  // ── 5) Remainder of your smooth heuristics ───────────────────────
  score = evaluatePosition(board, aiDisc);
  score += evaluateCellControl(board, aiDisc);
  score += evaluateConnectionPotential(board, aiDisc);
  score -= evaluateConnectionPotential(board, humanDisc) * OPP_CONN_POT_WEIGHT;

  const twoStep = countTwoStepForks(board, aiDisc);
  score -= twoStep * TWO_STEP_FORK_WEIGHT;

  return score;
}

/** Sum up all horizontal, vertical, diagonal windows and center‐column bonuses. */
function evaluatePosition(
  board: CellValue[][],
  aiDisc: CellValue
): number {
  const rows = board.length;
  const cols = board[0].length;
  const humanDisc = aiDisc === 'Red' ? 'Yellow' : 'Red';
  let s = 0;

  // 1) Horizontal windows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols - WINDOW; c++) {
      const w = board[r].slice(c, c + WINDOW);
      s += evaluateWindow(w, aiDisc) * (r === 0 ? TOP_ROW_PENALTY_FACTOR : 1);
    }
  }

  // 2) Vertical windows
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r <= rows - WINDOW; r++) {
      const w = [0, 1, 2, 3].map(i => board[r + i][c]);
      s += evaluateWindow(w, aiDisc) * (r === 0 ? TOP_ROW_PENALTY_FACTOR : 1);
    }
  }

  // 3) Diagonal ↘ and ↙ windows
  for (let r = 0; r <= rows - WINDOW; r++) {
    for (let c = 0; c <= cols - WINDOW; c++) {
      const dr = [0, 1, 2, 3].map(i => board[r + i][c + i]);
      s += evaluateWindow(dr, aiDisc) * (r === 0 ? TOP_ROW_PENALTY_FACTOR : 1);
      const dl = [0, 1, 2, 3].map(i => board[r + i][c + WINDOW - 1 - i]);
      s += evaluateWindow(dl, aiDisc) * (r === 0 ? TOP_ROW_PENALTY_FACTOR : 1);
    }
  }

  // 4) Center‐column bonus/penalty
  const centerCol = Math.floor(cols / 2);
  for (let r = 0; r < rows; r++) {
    if (board[r][centerCol] === aiDisc) s += CENTER_COLUMN_BONUS;
    else if (board[r][centerCol] === humanDisc) s -= CENTER_COLUMN_BONUS;
  }

  return s;
}


/** Transposition table with Zobrist hashing **/
export enum EntryFlag { Exact, LowerBound, UpperBound }
export interface TranspositionEntry {
  score: number;
  depth: number;
  column: number | null;
  flag: EntryFlag;
}

const MAX_ENTRIES = 1_000_000;
const transposition = new Map<bigint, TranspositionEntry>();

export function rand64(): bigint {
  const buf = require('crypto').randomBytes(8);
  let n = 0n;
  buf.forEach((b: number) => {
    n = (n << 8n) | BigInt(b);
  });
  return n;
}

const ZOBRIST_TABLE: bigint[][][] = Array.from({ length: 6 }, () =>
  Array.from({ length: 7 }, () => [rand64(), rand64(), rand64()]));

export function hashBoard(board: CellValue[][]): bigint {
  let h = 0n;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const idx = board[r][c] === 'Red' ? 1 : board[r][c] === 'Yellow' ? 2 : 0;
      h ^= ZOBRIST_TABLE[r][c][idx];
    }
  }
  return h;
}

export function clearTable(): void {
  transposition.clear();
}

export function getEntry(
  hash: bigint
): TranspositionEntry | undefined {
  return transposition.get(hash);
}

export function storeEntry(
  hash: bigint,
  entry: TranspositionEntry
): void {
  const existing = transposition.get(hash);
  if (
    !existing ||
    entry.depth > existing.depth ||
    entry.flag === EntryFlag.Exact
  ) {
    if (transposition.size > MAX_ENTRIES) {
      let toEvict = Math.floor(MAX_ENTRIES * 0.1);

      for (const key of transposition.keys()) {
        transposition.delete(key);
        toEvict--;
        if (toEvict <= 0)
          break;
      }
    }
    transposition.set(hash, entry);
  }
}

/** Minimax with α–β, null-move pruning, history, transposition, and advanced logging **/
interface Node {
  score: number;
  column: number | null;
}

const NULL_MOVE_REDUCTION = 2;

export function minimax(
  board: CellValue[][],
  depth: number,
  alpha: number,
  beta: number,
  maximizingPlayer: boolean,
  aiDisc: CellValue
): Node {
  const oppDisc = aiDisc === 'Red' ? 'Yellow' : 'Red';
  const key = hashBoard(board);
  const entry = getEntry(key);

  // ─── Transposition lookup ───────────────────────────────
  if (entry && entry.depth >= depth) {
    if (entry.flag === EntryFlag.Exact) {
      return { score: entry.score, column: entry.column };
    }
    if (entry.flag === EntryFlag.LowerBound) {
      alpha = Math.max(alpha, entry.score);
    } else if (entry.flag === EntryFlag.UpperBound) {
      beta = Math.min(beta, entry.score);
    }
    if (alpha >= beta) {
      return { score: entry.score, column: entry.column };
    }
  }

  // ─── Quiescence at depth 0 ──────────────────────────────
  if (depth <= 0) {
    return quiesce(board, alpha, beta, aiDisc);
  }

  // ─── Guarded Null‐Move Pruning ───────────────────────────
  // only if we have depth left AND opponent has no immediate win/fork double‐threat
  if (
    depth > NULL_MOVE_REDUCTION + 1 &&
    !hasImmediateWin(board, oppDisc) &&
    countOpenThree(board, oppDisc) <= 1
  ) {
    const R = NULL_MOVE_REDUCTION;
    const { score: nullScore } = minimax(
      board,
      depth - R - 1,
      -beta,
      -beta + 1,
      !maximizingPlayer,
      aiDisc
    );
    if (-nullScore >= beta) {
      return { score: beta, column: null };
    }
  }

  // ─── Main α–β Search ────────────────────────────────────
  let best: Node = { score: -Infinity, column: null };
  const alphaOrig = alpha;
  const moves = legalMoves(board);

  for (const col of moves) {
    const { board: next } = tryDrop(
      board,
      col,
      maximizingPlayer ? aiDisc : oppDisc
    );

    const node = minimax(
      next,
      depth - 1,
      -beta,
      -alpha,
      !maximizingPlayer,
      aiDisc
    );
    const score = -node.score;

    if (score > best.score) {
      best = { score, column: col };
    }

    alpha = Math.max(alpha, score);
    if (alpha >= beta) {
      break;
    }
  }

  // ─── Store in Transposition Table ───────────────────────
  let flag: EntryFlag;
  if (best.score <= alphaOrig) {
    flag = EntryFlag.UpperBound;
  } else if (best.score >= beta) {
    flag = EntryFlag.LowerBound;
  } else {
    flag = EntryFlag.Exact;
  }
  storeEntry(key, { score: best.score, depth, flag, column: best.column });

  return best;
}

/**
 * True if `disc` can win immediately on the next move.
 */
function hasImmediateWin(board: CellValue[][], disc: CellValue): boolean {
  for (const col of legalMoves(board)) {
    const { board: after } = tryDrop(board, col, disc);
    if (bitboardCheckWin(getBits(after, disc))) {
      return true;
    }
  }
  return false;
}

/** Monte Carlo Tree Search **/
export interface MCTSNode {
  board: CellValue[][];
  player: CellValue;
  visits: number;
  wins: number;
  parent: MCTSNode | null;
  children: MCTSNode[];
  move: number | null;
}

export function cloneBoard(board: CellValue[][]): CellValue[][] {
  return board.map((r) => [...r]);
}

export function softmax(scores: number[], temperature = 1): number[] {
  const exps = scores.map((s) => Math.exp(s / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export function chooseWeighted(
  moves: number[],
  weights: number[]
): number {
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < moves.length; i++) {
    cum += weights[i];
    if (r < cum) return moves[i];
  }
  return moves[moves.length - 1];
}

export function playout(
  startBoard: CellValue[][],
  startingPlayer: CellValue,
  _aiDisc: CellValue
): CellValue {
  let board = cloneBoard(startBoard);
  let current = startingPlayer;
  while (true) {
    const moves = legalMoves(board);
    if (!moves.length) return 'Empty';
    const scores = moves.map((c) => {
      const nextBoard = tryDrop(board, c, current).board;
      return evaluateBoard(nextBoard, current);
    });
    const col = chooseWeighted(moves, softmax(scores));
    const nextRes = tryDrop(board, col, current);
    board = nextRes.board;
    if (bitboardCheckWin(getBits(board, current))) return current;
    current = current === 'Red' ? 'Yellow' : 'Red';
  }
}

export function select(node: MCTSNode): MCTSNode {
  let cur = node;
  while (cur.children.length) {
    cur = cur.children.reduce((best, child) => {
      const uct =
        child.wins / (child.visits + 1e-9) +
        Math.sqrt(2 * Math.log(cur.visits + 1) / (child.visits + 1e-9));
      const ubest =
        best.wins / (best.visits + 1e-9) +
        Math.sqrt(2 * Math.log(cur.visits + 1) / (best.visits + 1e-9));
      return uct > ubest ? child : best;
    });
  }
  return cur;
}

export function expand(node: MCTSNode): void {
  const moves = legalMoves(node.board);
  const next = node.player === 'Red' ? 'Yellow' : 'Red';
  moves.forEach((col) => {
    const res = tryDrop(node.board, col, next);
    node.children.push({
      board: res.board,
      player: next,
      visits: 0,
      wins: 0,
      parent: node,
      children: [],
      move: col,
    });
  });
}

export function backpropagate(
  node: MCTSNode,
  winner: CellValue,
  aiDisc: CellValue
): void {
  let cur: MCTSNode | null = node;
  while (cur) {
    cur.visits++;
    if (winner === aiDisc) cur.wins++;
    cur = cur.parent;
  }
}

export function mcts(
  rootBoard: CellValue[][],
  aiDisc: CellValue,
  timeMs: number
): number {
  const opponent: CellValue = aiDisc === 'Red' ? 'Yellow' : 'Red';

  // 1) Create root node (AI just played before this, so it's opponent's turn)
  const root: MCTSNode = {
    board: cloneBoard(rootBoard),
    player: opponent,
    visits: 0,
    wins: 0,
    parent: null,
    children: [],
    move: null,
  };

  const endTime = Date.now() + timeMs;

  while (Date.now() < endTime) {
    // ─── Selection ───────────────────────────────────────────
    let node = root;
    while (node.children.length > 0) {
      node = node.children.reduce((best, child) => {
        // UCT = w_i/n_i + c * sqrt(ln(N)/n_i)
        const C = Math.SQRT2;
        const uctChild =
          child.wins / (child.visits + 1e-9) +
          C * Math.sqrt(Math.log(node.visits + 1) / (child.visits + 1e-9));
        const uctBest =
          best.wins / (best.visits + 1e-9) +
          C * Math.sqrt(Math.log(node.visits + 1) / (best.visits + 1e-9));
        return uctChild > uctBest ? child : best;
      });
    }

    // ─── Expansion ───────────────────────────────────────────
    // If we've visited once and no children yet, expand all legal moves
    if (node.visits > 0) {
      const nextPlayer = node.player === 'Red' ? 'Yellow' : 'Red';
      for (const col of legalMoves(node.board)) {
        const { board: nextBoard } = tryDrop(node.board, col, nextPlayer);
        node.children.push({
          board: nextBoard,
          player: nextPlayer,
          visits: 0,
          wins: 0,
          parent: node,
          children: [],
          move: col,
        });
      }
      // pick one child to simulate
      if (node.children.length > 0) {
        node = node.children[0];
      }
    }

    // ─── Simulation (Playout) ─────────────────────────────────
    let simBoard = cloneBoard(node.board);
    let simPlayer = node.player;
    let winner: CellValue | 'draw' = 'draw';

    while (true) {
      const moves = legalMoves(simBoard);
      if (moves.length === 0) break;             // draw
      const col = moves[Math.floor(Math.random() * moves.length)];
      const { board: nb } = tryDrop(simBoard, col, simPlayer);
      simBoard = nb;
      if (bitboardCheckWin(getBits(simBoard, simPlayer))) {
        winner = simPlayer;
        break;
      }
      simPlayer = simPlayer === 'Red' ? 'Yellow' : 'Red';
    }

    // ─── Backpropagation ──────────────────────────────────────
    let cur: MCTSNode | null = node;
    while (cur) {
      cur.visits++;
      if (winner === aiDisc) {
        cur.wins++;
      }
      cur = cur.parent;
    }
  }

  // ─── Choose best move: child of root with highest visits ───
  if (root.children.length === 0) {
    // fallback: pick any legal move
    return legalMoves(rootBoard)[0];
  }
  const bestChild = root.children.reduce((best, c) =>
    c.visits > best.visits ? c : best
  );
  return bestChild.move!;
}


// Search settings
const ENGINE_MAX_DEPTH = 12;
const THREAT_THRESHOLD = 1;

/**
 * Detect all single-move forks (3 in a row + 1 gap) for the opponent,
 * score them by direction, center-distance, and threat depth,
 * then return the best column to block or null if none.
 */
/**
 * Detect all single-move forks (3 in a row + 1 gap) for the opponent,
 * score them by direction, center-distance, and threat depth,
 * then return the best column to block or null if none.
 * **Debug logs** added to trace window scanning and decisions.
 */
export function findOpenThreeBlock(
  board: CellValue[][],
  oppDisc: CellValue
): number | null {
  console.log('[findOpenThreeBlock] ENTER', { rows: board.length, cols: board[0].length, oppDisc });
  try {
    const ROWS = board.length;
    const COLS = board[0].length;
    if (ROWS === 0 || COLS === 0) {
      console.error('[findOpenThreeBlock] Invalid board shape', board);
      return null;
    }

    const WINDOW = 4;
    const center = Math.floor(COLS / 2);
    const DIR_WEIGHTS: Record<string, number> = {
      horiz: 5,
      vert: 3,
      diagDR: 4,
      diagDL: 4,
    };

    const threatScores = new Map<number, number>();
    const threats: Array<{ col: number; row: number; dir: string; score: number }> = [];

    // ───────────── HORIZONTAL ─────────────
    {
      const key = 'horiz';
      const weight = DIR_WEIGHTS[key];
      
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c <= COLS - WINDOW; c++) {
          
          const cells = [board[r][c], board[r][c+1], board[r][c+2], board[r][c+3]];
          const coords: [number, number][] = [[r,c],[r,c+1],[r,c+2],[r,c+3]];
          
          console.log(`[findOpenThreeBlock] scanning horiz start=(${r},${c})`, cells);
          const oppCount = cells.filter(x => x === oppDisc).length;
          const emptyCount = cells.filter(x => x === 'Empty').length;
          
          if (oppCount === 3 && emptyCount === 1) {
            console.log(`[findOpenThreeBlock] pattern match horiz`, cells, coords);
          
            const gapIdx = cells.findIndex(x => x === 'Empty');
            const [gapRow, gapCol] = coords[gapIdx];
            const dropRow = getDropRow(board, gapCol);
          
            console.log(`[findOpenThreeBlock] dropRow col=${gapCol} ->`, dropRow);
            if (dropRow === gapRow) {
              console.log(`[findOpenThreeBlock] gravity OK horiz col=${gapCol} row=${gapRow}`);
          
              const centerDist = Math.abs(gapCol - center);
              const depthBonus = WINDOW - Math.max(gapIdx, WINDOW - 1 - gapIdx) * 2;
              const score = weight * 100 - centerDist * 10 + depthBonus;
              const prev = threatScores.get(gapCol) ?? -Infinity;
          
              threatScores.set(gapCol, Math.max(prev, score));
              threats.push({ col: gapCol, row: gapRow, dir: key, score });
            } else {
              console.log(`[findOpenThreeBlock] gravity fail horiz gapRow=${gapRow} dropRow=${dropRow}`);
            }
          }
        }
      }
    }

    // ───────────── VERTICAL ──────────────
    {
      const key = 'vert';
      const weight = DIR_WEIGHTS[key];
      
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r <= ROWS - WINDOW; r++) {
          const cells = [board[r][c], board[r+1][c], board[r+2][c], board[r+3][c]];
          const coords: [number, number][] = [[r,c],[r+1,c],[r+2,c],[r+3,c]];
          
          console.log(`[findOpenThreeBlock] scanning vert start=(${r},${c})`, cells);
          
          const oppCount = cells.filter(x => x === oppDisc).length;
          const emptyCount = cells.filter(x => x === 'Empty').length;
          
          if (oppCount === 3 && emptyCount === 1) {
            console.log(`[findOpenThreeBlock] pattern match vert`, cells, coords);
            
            const gapIdx = cells.findIndex(x => x === 'Empty');
            const [gapRow, gapCol] = coords[gapIdx];
            const dropRow = getDropRow(board, gapCol);
            
            console.log(`[findOpenThreeBlock] dropRow col=${gapCol} ->`, dropRow);
            
            if (dropRow === gapRow) {
              console.log(`[findOpenThreeBlock] gravity OK vert col=${gapCol} row=${gapRow}`);
              
              const centerDist = Math.abs(gapCol - center);
              const depthBonus = WINDOW - Math.max(gapIdx, WINDOW - 1 - gapIdx) * 2;
              const score = weight * 100 - centerDist * 10 + depthBonus;
              const prev = threatScores.get(gapCol) ?? -Infinity;
              
              threatScores.set(gapCol, Math.max(prev, score));
              threats.push({ col: gapCol, row: gapRow, dir: key, score });
            } else {
              console.log(`[findOpenThreeBlock] gravity fail vert gapRow=${gapRow} dropRow=${dropRow}`);
            }
          }
        }
      }
    }

    // ─────────── DIAGONAL DOWN-RIGHT ───────────
    {
      const key = 'diagDR';
      const weight = DIR_WEIGHTS[key];

      for (let r = 0; r <= ROWS - WINDOW; r++) {
        for (let c = 0; c <= COLS - WINDOW; c++) {
          
          const cells = [board[r][c], board[r+1][c+1], board[r+2][c+2], board[r+3][c+3]];
          const coords: [number, number][] = [[r,c],[r+1,c+1],[r+2,c+2],[r+3,c+3]];
          
          console.log(`[findOpenThreeBlock] scanning diagDR start=(${r},${c})`, cells);
          
          const oppCount = cells.filter(x => x === oppDisc).length;
          const emptyCount = cells.filter(x => x === 'Empty').length;
          
          if (oppCount === 3 && emptyCount === 1) {
            console.log(`[findOpenThreeBlock] pattern match diagDR`, cells, coords);
            
            const gapIdx = cells.findIndex(x => x === 'Empty');
            const [gapRow, gapCol] = coords[gapIdx];
            const dropRow = getDropRow(board, gapCol);
            
            console.log(`[findOpenThreeBlock] dropRow col=${gapCol} ->`, dropRow);
            
            if (dropRow === gapRow) {
              
              console.log(`[findOpenThreeBlock] gravity OK diagDR col=${gapCol} row=${gapRow}`);
              
              const centerDist = Math.abs(gapCol - center);
              const depthBonus = WINDOW - Math.max(gapIdx, WINDOW - 1 - gapIdx) * 2;
              const score = weight * 100 - centerDist * 10 + depthBonus;
              const prev = threatScores.get(gapCol) ?? -Infinity;
              
              threatScores.set(gapCol, Math.max(prev, score));
              threats.push({ col: gapCol, row: gapRow, dir: key, score });
            } else {
              console.log(`[findOpenThreeBlock] gravity fail diagDR gapRow=${gapRow} dropRow=${dropRow}`);
            }
          }
        }
      }
    }

    // ─────────── DIAGONAL DOWN-LEFT ───────────
    {
      const key = 'diagDL';
      const weight = DIR_WEIGHTS[key];
      
      for (let r = WINDOW - 1; r < ROWS; r++) {
        for (let c = 0; c <= COLS - WINDOW; c++) {
          
          const cells = [board[r][c], board[r-1][c+1], board[r-2][c+2], board[r-3][c+3]];
          const coords: [number, number][] = [[r,c],[r-1,c+1],[r-2,c+2],[r-3,c+3]];
          
          console.log(`[findOpenThreeBlock] scanning diagDL start=(${r},${c})`, cells);
          
          const oppCount = cells.filter(x => x === oppDisc).length;
          const emptyCount = cells.filter(x => x === 'Empty').length;
          
          if (oppCount === 3 && emptyCount === 1) {
            console.log(`[findOpenThreeBlock] pattern match diagDL`, cells, coords);
            
            const gapIdx = cells.findIndex(x => x === 'Empty');
            const [gapRow, gapCol] = coords[gapIdx];
            const dropRow = getDropRow(board, gapCol);
            
            console.log(`[findOpenThreeBlock] dropRow col=${gapCol} ->`, dropRow);
            
            if (dropRow === gapRow) {
              console.log(`[findOpenThreeBlock] gravity OK diagDL col=${gapCol} row=${gapRow}`);
              
              const centerDist = Math.abs(gapCol - center);
              const depthBonus = WINDOW - Math.max(gapIdx, WINDOW - 1 - gapIdx) * 2;
              const score = weight * 100 - centerDist * 10 + depthBonus;
              const prev = threatScores.get(gapCol) ?? -Infinity;
              
              threatScores.set(gapCol, Math.max(prev, score));
              threats.push({ col: gapCol, row: gapRow, dir: key, score });
            } else {
              console.log(`[findOpenThreeBlock] gravity fail diagDL gapRow=${gapRow} dropRow=${dropRow}`);
            }
          }
        }
      }
    }

    if (threatScores.size === 0) {
      console.log('[findOpenThreeBlock] No playable threats detected -> return null');
      return null;
    }

    let bestCol: number | null = null;
    let bestScore = -Infinity;
    
    for (const [col, score] of threatScores) {
      if (score > bestScore) {
        bestScore = score;
        bestCol = col;
      }
    }

    console.log('[findOpenThreeBlock] Threats:', threats);
    console.log(`[findOpenThreeBlock] Chosen block col=${bestCol} score=${bestScore}`);
    return bestCol;
  } catch (error) {
    console.error('[findOpenThreeBlock] Unexpected error:', error);
    return null;
  }
}

/** 
 * Count all “3-in-a-row + 1 gap” fork threats the opponent will have
 * if you don’t block. Stops early once ≥2 are found.
 */
export function countOpenThree(
    board: CellValue[][],
    opp: CellValue
  ): number {
    const ROWS = board.length;
    const COLS = board[0].length;
    const WINDOW = 4;

    // directions with a string key for dedup
    const dirs = [
      { dr: 0, dc: 1, key: 'horiz' },
      { dr: 1, dc: 0, key: 'vert' },
      { dr: 1, dc: 1, key: 'diagDR' },
      { dr: 1, dc: -1, key: 'diagDL' },
    ];

    const seen = new Set<string>();
    let threatCount = 0;

    for (const { dr, dc, key } of dirs) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          // gather up to WINDOW cells along this direction
          const cells: CellValue[] = [];
          const coords: [number, number][] = [];

          for (let i = 0; i < WINDOW; i++) {
            const rr = r + dr * i;
            const cc = c + dc * i;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS)
              break;
            cells.push(board[rr][cc]);
            coords.push([rr, cc]);
          }

          if (cells.length < WINDOW) continue;

          // exactly 3 opponent discs + 1 empty?
          const oppCnt = cells.filter(x => x === opp).length;
          const empCnt = cells.filter(x => x === 'Empty').length;

          if (oppCnt === 3 && empCnt === 1) {
            const gapIdx = cells.findIndex(x => x === 'Empty');
            const [gapRow, gapCol] = coords[gapIdx];

            // strict gravity check
            if (getDropRow(board, gapCol) === gapRow) {
              const threatKey = `${gapRow},${gapCol},${key}`;
              if (!seen.has(threatKey)) {
                seen.add(threatKey);
                threatCount++;

                if (threatCount >= 2)
                  return threatCount;
              }
            }
          }
        }
      }
    }

    return threatCount;
  }

  /** Returns a winning a column for `disc`, or `null` if none. **/
  function findImmediateWin(
    board: CellValue[][],
    disc: CellValue,
    moves: number[]): number | null {
    for (const col of moves) {
      const { board: after } = tryDrop(board, col, disc);

      if (bitboardCheckWin(getBits(after, disc))) {
        return col;
      }
    }
    return null;
  }

  /** Builds a map of "threat counts" for each possible move. **/
  function computeThreatCounts(
    board: CellValue[][],
    aiDisc: CellValue,
    oppDisc: CellValue,
    moves: number[]
  ): Record<number, number> {
    const counts: Record<number, number> = {};

    for (const col of moves) {
      // 1) Simulate AI drop.
      const { board: b1 } = tryDrop(board, col, aiDisc);

      // A) Count direct replies where opponent wins. 
      const replyWins = legalMoves(b1).filter(reply => {
        const { board: b2 } = tryDrop(b1, reply, oppDisc);
      }).length;

      // B) Count opponent forks.
      const forks = countOpenThree(b1, oppDisc);
      counts[col] = replyWins + forks;
    }
    return counts;
  }

  /** Chooses the safest, then most central, columns. */
  function selectCandidates(
    moves: number[],
    threatCounts: Record<number, number>
  ): number[] {
    // Filter by threshold.
    let cands = moves.filter(c => threatCounts[c] <= THREAT_THRESHOLD);

    // If none, pick the minimal-threat ones. 
    if (cands.length === 0) {
      const minCount = Math.min(...moves.map(c => threatCounts[c]));
      cands = moves.filter(c => threatCounts[c] === minCount);
    }

    // Sort by (1) fewest threats, then (2) closeness to center. 
    return cands.sort((a, b) => {
      const diff = threatCounts[a] - threatCounts[b];

      if (diff !== 0)
        return diff;

      return Math.abs(3 - a) - Math.abs(3 - b);
    });
  }

  /**
   * Top-level AI entry point, now blocking ANY open-three.
   */
  export function getBestAIMove(
    board: CellValue[][],
    aiDisc: CellValue,
    timeMs = 200
  ): number {
    clearTable();
    const moves = legalMoves(board);
    const totalCells = board.length * board[0].length;
    const emptyCells = board.flat().filter(c => c === 'Empty').length;
    const oppDisc = aiDisc === 'Red' ? 'Yellow' : 'Red';

    console.group(`[AI] getBestAIMove start — AI=${aiDisc}`);
    console.debug(' Board empties:', emptyCells, '/', totalCells);
    console.debug(' Legal moves:', moves);

    // ── 1) Immediate AI win ───────────────────────────────────────
    for (const col of moves) {
      const { board: b2 } = tryDrop(board, col, aiDisc);
      if (bitboardCheckWin(getBits(b2, aiDisc))) {
        console.debug(' 🔥 AI wins immediately at col', col);
        console.groupEnd();
        return col;
      }
    }

    // ── 2) Immediate 4-in-a-row block ────────────────────────────
    for (const col of moves) {
      const { board: b2 } = tryDrop(board, col, oppDisc);
      if (bitboardCheckWin(getBits(b2, oppDisc))) {
        console.debug(' 🛑 Block opponent win at col', col);
        console.groupEnd();
        return col;
      }
    }

    // ── 3) Block any vertical-3 (floating or bottom) ─────────────────
    const vertCol = blockVerticalThreeIfAny(board, aiDisc);

    if (vertCol !== null) {
      console.debug(' ⚠️ Aggressive vertical-3 block at col', vertCol);
      console.groupEnd();
      return vertCol;
    }

    //  ── 4) Block any strict 3-in-a-row that’s actually playable (incl. diagonals)
    const strictBlock = findOpenThreeBlock(board, oppDisc);

    if (strictBlock !== null) {
      console.debug(' ⚠️ Block playable three at col', strictBlock);
      console.groupEnd();
      return strictBlock;
    }

    // ── 5) Block any “3+1” in any direction, ignoring gravity ─────────────────
    const floatCol = blockFloatingOpenThree(board, aiDisc);

    if (floatCol !== null) {
      console.debug(' ⚠️ Aggressive open-three block at col', floatCol);
      console.groupEnd();
      return floatCol;
    }

    // ── 6) Immediate 3-in-a-row (open-three) block ───────────────
    // If opponent already has any “3 + empty” window, block it now:
    const humanThrees = countOpenThree(board, oppDisc);

    if (humanThrees > 0) {
      // find the column that kills that open-three
      for (const col of moves) {
        const { board: b2 } = tryDrop(board, col, aiDisc);
        if (countOpenThree(b2, oppDisc) < humanThrees) {
          console.debug(' ⚠️ Block open-three at col', col);
          console.groupEnd();
          return col;
        }
      }
    }

    // ── 7) Prune any suicide moves (they’d let opp win next) ──────
    const safeMoves = moves.filter(col => {
      const { board: b2 } = tryDrop(board, col, aiDisc);
      const opponentCanWin = legalMoves(b2).some(oppCol => {
        const { board: b3 } = tryDrop(b2, oppCol, oppDisc);
        return bitboardCheckWin(getBits(b3, oppDisc));
      });
      if (opponentCanWin) {
        console.debug('  Move', col, 'is unsafe → opponent wins next');
        return false;
      }
      return true;
    });
    const movesToSearch = safeMoves.length ? safeMoves : moves;
    console.debug(' Moves to search:', movesToSearch);

    // ── 8) Threat scan & candidate selection ─────────────────────
    const threatCounts = computeThreatCounts(board, aiDisc, oppDisc, movesToSearch);
    console.debug(' Threat counts:', threatCounts);
    let candidates = selectCandidates(movesToSearch, threatCounts);
    console.debug(' Candidates:', candidates);

    // ── 9) Choose search strategy ────────────────────────────────
    const isEarly = emptyCells > totalCells * 0.6;
    const isLate = candidates.length <= 5;
    console.debug(` isEarly=${isEarly}, isLate=${isLate}`);

    // ── 10) Late game: iterative‐deepening minimax ────────────────
    if (isLate) {
      const start = performance.now();
      const maxDepth = Math.min(ENGINE_MAX_DEPTH, emptyCells);
      let best = candidates[0];
      console.group(' Late‐game minimax');
      for (let d = 4; d <= maxDepth; d += 2) {
        if (performance.now() - start >= timeMs) {
          console.debug('  ⏱ Time up at depth', d);
          break;
        }
        const { column, score } = minimax(board, d, -Infinity, Infinity, true, aiDisc);
        console.debug(`  depth=${d} → col=${column} score=${score.toFixed(1)}`);
        if (column !== null && candidates.includes(column)) {
          best = column;
          console.debug('   ✨ New best:', best);
        }
      }
      console.groupEnd();
      console.debug(' → Late pick:', best);
      console.groupEnd();
      return best;
    }

    // ── 11) Early game: MCTS ───────────────────────────────────────
    if (isEarly) {
      console.group(' Early6‐game MCTS');
      const t0 = performance.now();
      const col = mcts(board, aiDisc, timeMs);
      const pick = candidates.includes(col) ? col : candidates[0];
      console.debug(`  MCTS → col=${col} time=${(performance.now() - t0).toFixed(1)}ms`);
      console.debug(' → Early pick:', pick);
      console.groupEnd();
      console.groupEnd();
      return pick;
    }

    // ── 12) Mid‐game fallback: full‐depth minimax ────────────────
    console.group(' Mid‐game fallback minimax');
    const depth = Math.min(ENGINE_MAX_DEPTH, emptyCells);
    const { column, score } = minimax(board, depth, -Infinity, Infinity, true, aiDisc);
    const pick = column !== null && candidates.includes(column) ? column : candidates[0];
    console.debug(`  depth=${depth} → col=${column} score=${score.toFixed(1)}`);
    console.debug(' → Fallback pick:', pick);
    console.groupEnd();
    console.groupEnd();
    return pick;
  }

  /**
   * Beefed-up vertical-3 guard:
   *   • Scans every 4-cell vertical window (rows r…r+3 in each column)
   *   • If it finds ≥3 opponent discs in that window, it blocks by dropping
   *     in that column (nextEmptyRow), regardless of whether the hole is
   *     “floating” or at the bottom.
   *   • Emits detailed debug logs for every step.
   */
  export function blockVerticalThreeIfAny(
    board: CellValue[][],
    aiDisc: CellValue
  ): number | null {
    console.group('[AI] blockVerticalThreeIfAny (ultimate) start');
    const startTime = performance.now();

    try {
      const rows = board.length;
      const cols = board[0].length;
      const oppDisc: CellValue = aiDisc === 'Red' ? 'Yellow' : 'Red';
      console.debug(' Opponent disc:', oppDisc);

      // Performance and threat counters
      let totalWindows = 0;
      let threatWindows = 0;

      const threatDetails: {
        col: number; rowRange: [number, number];
        oppCount: number; emptyCount: number
      }[] = [];

      // Helper: find next empty row in column c
      const nextEmptyRow = (c: number): number => {
        for (let r = rows - 1; r >= 0; r--) {
          if (board[r][c] === 'Empty') {
            return r;
          }
        }
        return -1;
      };

      // Scan every column
      for (let c = 0; c < cols; c++) {
        console.group(`Scanning column ${c}`);
        const dropRow = nextEmptyRow(c);
        console.debug(`  Next empty row: ${dropRow}`);

        // Slide a window of 4 cells vertically
        for (let r0 = 0; r0 <= rows - 4; r0++) {
          totalWindows++;
          const values = [0, 1, 2, 3].map(i => board[r0 + i][c]);
          const oppCount = values.filter(v => v === oppDisc).length;
          const emptyCount = values.filter(v => v === 'Empty').length;
          const rowRange: [number, number] = [r0, r0 + 3];

          console.debug(
            `  Window ${rowRange[0]}→${rowRange[1]}: vals=[${values.join(',')}], ` +
            `oppCount=${oppCount}, emptyCount=${emptyCount}`
          );

          // Record any potential threat or chance
          if (oppCount >= 2 && emptyCount >= 1) {
            threatWindows++;
            threatDetails.push({ col: c, rowRange, oppCount, emptyCount });
            console.warn(
              `   Threat detected: oppCount=${oppCount}, emptyCount=${emptyCount}`
            );
          }
        }
        console.debug(`  Completed ${rows - 3} windows in column ${c}`);
        console.groupEnd();
      }

      // Summarize scanning
      const elapsed = (performance.now() - startTime).toFixed(2);
      console.info(
        ` Scanned ${totalWindows} windows, found ${threatWindows} potential threats in ${elapsed}ms`
      );

      if (threatDetails.length === 0) {
        console.groupEnd();
        return null;
      }

      // Choose the highest-priority threat: highest oppCount, then lowest emptyCount
      threatDetails.sort((a, b) => {
        if (b.oppCount !== a.oppCount) return b.oppCount - a.oppCount;
        return a.emptyCount - b.emptyCount;
      });
      const top = threatDetails[0];

      console.info(
        ` Blocking top threat in col=${top.col}, rows ${top.rowRange[0]}–${top.rowRange[1]}, ` +
        `oppCount=${top.oppCount}, emptyCount=${top.emptyCount}`
      );

      console.groupEnd();
      return top.col;
    } catch (error: any) {
      console.error('[AI] blockVerticalThreeIfAny ERROR:', error);
      console.groupEnd();

      return null;
    }
  }

  /**
   * Ultimate “floating” open-three blocker:
   *   • Scans every 4-cell window in all directions
   *   • Records all windows with ≥2 opponent discs and ≥1 empty
   *   • Prioritizes by highest oppCount, lowest emptyCount, window centrality
   *   • Ignores gravity; blocks at the window's empty cell column
   */
  export function blockFloatingOpenThree(
    board: CellValue[][],
    aiDisc: CellValue
  ): number | null {
    console.group('[AI] blockFloatingOpenThree (ultimate) start');
    const t0 = performance.now();
    try {
      const rows = board.length;
      const cols = board[0].length;
      const oppDisc: CellValue = aiDisc === 'Red' ? 'Yellow' : 'Red';
      console.debug(' Opponent disc:', oppDisc);

      interface Threat {
        col: number;
        oppCount: number;
        emptyCount: number;
        coords: [number, number][]
      }

      const threats: Threat[] = [];

      const dirs: [
        number,
        number][] = [
          [0, 1],
          [1, 0],
          [1, 1],
          [1, -1]
        ];

      let total = 0;

      for (const [dr, dc] of dirs) {
        console.group(` Scanning dr=${dr}, dc=${dc}`);
        for (let r0 = 0; r0 < rows; r0++) {
          for (let c0 = 0; c0 < cols; c0++) {
            const coords: [number, number][] = [];
            for (let i = 0; i < 4; i++)
              coords.push([r0 + dr * i, c0 + dc * i]);

            if (!coords.every(([r, c]) => r >= 0 && r < rows && c >= 0 && c < cols))
              continue;

            total++;
            const vals = coords.map(([r, c]) => board[r][c]);
            const oppCount = vals.filter(v => v === oppDisc).length;
            const emptyIndices = vals.map((v, i) => v === 'Empty' ? i : -1).filter(i => i >= 0);

            console.debug(
              `  Window@[${coords.map(c => c.join(',')).join('|')}] ` +
              `vals=[${vals.join(',')}], opp=${oppCount}, empty=${emptyIndices.length}`
            );

            if (oppCount >= 2 && emptyIndices.length >= 1) {
              emptyIndices.forEach(idx => {
                const [er, ec] = coords[idx];
                console.warn(
                  `   Threat opp=${oppCount} at (${er},${ec}) in window` +
                  `${coords.map(c => c.join(',')).join('|')}`
                );
                threats.push({ col: ec, oppCount, emptyCount: emptyIndices.length, coords });
              });
            }
          }
        }
        console.debug(`  Completed scanning direction dr=${dr},dc=${dc}`);
        console.groupEnd();
      }

      const t1 = performance.now();
      console.info(` Scanned ${total} windows in ${(t1 - t0).toFixed(2)}ms, found ${threats.length} threats`);

      if (threats.length === 0) {
        console.groupEnd();
        return null;
      }

      // Prioritize: highest oppCount, then lowest emptyCount, then centered window
      threats.sort((a, b) => {
        if (b.oppCount !== a.oppCount) return b.oppCount - a.oppCount;
        if (a.emptyCount !== b.emptyCount) return a.emptyCount - b.emptyCount;
        // center closeness can be added, e.g. average column distance to board center
        return 0;
      });

      const top = threats[0];

      console.info(
        ` 🚨 Blocking top floating threat at col=${top.col}, ` +
        `opp=${top.oppCount}, emptySlots=${top.emptyCount}, window=` +
        `${top.coords.map(c => c.join(',')).join('|')}`
      );

      console.groupEnd();
      return top.col;
    } catch (err: any) {
      console.error('[AI] blockFloatingOpenThree ERROR:', err);
      console.groupEnd();
      return null;
    }
  }

  /**
 * Scan all diagonal ↘︎ and ↙︎ windows for 3 opponent discs + 1 empty,
 * ignoring gravity (floating), and return the column index of the gap,
 * or null if none found. Includes advanced logging and error handling.
 */
export function blockFloatingOpenThreeDiagonal(
  board: CellValue[][],
  oppDisc: CellValue
): number | null {
  console.log('[blockFloatingOpenThreeDiagonal] ENTER', { rows: board.length, cols: board[0]?.length, oppDisc });
  try {
    const ROWS = board.length;
    const COLS = board[0].length;

    if (!ROWS || !COLS) {
      console.error('[blockFloatingOpenThreeDiagonal] Invalid board shape', board);
      return null;
    }

    // Helper to scan a window
    const scanWindow = (
      coords: [number, number][],
      dir: string
    ): number | null => {
      const cells = coords.map(([r, c]) => board[r][c]);
      
      console.log(
        `[blockFloatingOpenThreeDiagonal] scanning ${dir}`,
        coords,
        'cells=', cells
      );

      const oppCount = cells.filter(x => x === oppDisc).length;
      const emptyCount = cells.filter(x => x === 'Empty').length;
      
      if (oppCount === 3 && emptyCount === 1) {
        const idx = cells.findIndex(x => x === 'Empty');
        const gapCol = coords[idx][1];
        console.log(
          `[blockFloatingOpenThreeDiagonal] pattern match ${dir}`,
          'gap at', coords[idx],
          `-> column ${gapCol}`
        );
        return gapCol;
      }
      return null;
    };

    // ↘︎ diagonal
    for (let r = 0; r <= ROWS - 4; r++) {
      for (let c = 0; c <= COLS - 4; c++) {
        const coords: [number, number][] = [
          [r, c], 
          [r + 1, c + 1], 
          [r + 2, c + 2], 
          [r + 3, c + 3]
        ];
        
        const col = scanWindow(coords, 'diagDR');
        
        if (col !== null) {
          return col;
        }
      }
    }

    // ↙︎ diagonal
    for (let r = 3; r < ROWS; r++) {
      for (let c = 0; c <= COLS - 4; c++) {
        const coords: [number, number][] = [
          [r, c], 
          [r - 1, c + 1], 
          [r - 2, c + 2], 
          [r - 3, c + 3]
        ];

        const col = scanWindow(coords, 'diagDL');
        
        if (col !== null) {
          return col;
        }
      }
    }

    console.log('[blockFloatingOpenThreeDiagonal] No floating diagonal threat found');
    return null;
  } catch (error) {
    console.error('[blockFloatingOpenThreeDiagonal] Unexpected error:', error);
    return null;
  }
}