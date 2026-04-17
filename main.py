import math
import time
import random
from typing import List, Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Tic-Tac-Toe AI Backend")

# --- STATS TRACKING ---
class AIStats:
    def __init__(self):
        self.nodes_explored = 0

stats = AIStats()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELS ---
class MoveRequest(BaseModel):
    board: List[Optional[str]]
    difficulty: str = "minimax"

class MoveResponse(BaseModel):
    index: int
    winner: Optional[str] = None
    is_draw: bool = False
    stats: dict = {}
    heatmap: List[dict] = []
    tree: Optional[dict] = None

# --- GAME CONSTANTS ---
WINNING_COMBOS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]

def check_winner(board: List[str]) -> Optional[str]:
    for a, b, c in WINNING_COMBOS:
        if board[a] and board[a] == board[b] == board[c]:
            return board[a]
    return None

def is_game_over(board: List[str]) -> bool:
    return all(cell != "" for cell in board) or check_winner(board) is not None

# --- THE REFACTORED BRAIN ---

def minimax(board, depth, is_maximizing, alpha, beta, difficulty, visual_limit):
    """
    Unified function for Minimax and Alpha-Beta.
    'alpha' and 'beta' are passed down even in standard Minimax,
    but the 'pruning' logic only triggers if difficulty is 'alphabeta'.
    """

    # 1. BASE CASES
    winner = check_winner(board)
    if winner == "O": return 10, {"name": "O", "attributes": {"score": 10}, "children": []}
    if winner == "X": return -10, {"name": "X", "attributes": {"score": -10}, "children": []}
    if all(c != "" for c in board): return 0, {"name": "Draw", "attributes": {"score": 0}, "children": []}

    stats.nodes_explored += 1
    empty_cells = [i for i, cell in enumerate(board) if cell == ""]
    children_nodes = []

    # 2. MAXIMIZING (AI Turn)
    if is_maximizing:
        best_score = -math.inf
        for idx in empty_cells:
            board[idx] = "O"
            score, child_ui = minimax(board, depth + 1, False, alpha, beta, difficulty, visual_limit)
            board[idx] = "" # Backtrack

            best_score = max(best_score, score)
            alpha = max(alpha, best_score)

            if depth < visual_limit:
                child_ui["name"] = f"AI:{idx}"
                children_nodes.append(child_ui)

            # --- THE ALPHA-BETA PRUNING CUT ---
            if difficulty == "alphabeta" and beta <= alpha:
                if children_nodes: children_nodes[-1]["attributes"]["pruned"] = True
                break

        node_data = {"name": "AI_Turn", "attributes": {"score": best_score}}
        if depth < visual_limit: node_data["children"] = children_nodes
        return best_score, node_data

    # 3. MINIMIZING (User Turn)
    else:
        best_score = math.inf
        for idx in empty_cells:
            board[idx] = "X"
            score, child_ui = minimax(board, depth + 1, True, alpha, beta, difficulty, visual_limit)
            board[idx] = "" # Backtrack

            best_score = min(best_score, score)
            beta = min(beta, best_score)

            if depth < visual_limit:
                child_ui["name"] = f"User:{idx}"
                children_nodes.append(child_ui)

            # --- THE ALPHA-BETA PRUNING CUT ---
            if difficulty == "alphabeta" and beta <= alpha:
                if children_nodes: children_nodes[-1]["attributes"]["pruned"] = True
                break # This cuts off unnecessary branches

        node_data = {"name": "User_Turn", "attributes": {"score": best_score}}
        if depth < visual_limit: node_data["children"] = children_nodes
        return best_score, node_data

@app.post("/api/move", response_model=MoveResponse)
def get_move(req: MoveRequest):
    start_time = time.time()
    stats.nodes_explored = 0
    board = ["" if cell is None else cell for cell in req.board]
    difficulty = req.difficulty.lower()

    empty = [i for i, c in enumerate(board) if c == ""]
    if not empty or check_winner(board):
        return MoveResponse(index=-1, winner=check_winner(board), is_draw=not any("" in b for b in board))

    best_idx = -1
    best_score = -math.inf
    heatmap = []
    root_node = {"name": "AI_ROOT", "children": []}

    # Evaluate all possible immediate moves
    for idx in empty:
        board[idx] = "O"

        # Determine score based on difficulty
        if difficulty == "easy":
            score = 1 if check_winner(board) == "O" else 0
            stats.nodes_explored += 1
            move_node = {"name": f"Move:{idx}", "attributes": {"score": score}, "children": []}
        else:
            score, move_node = minimax(board, 1, False, -math.inf, math.inf, difficulty, visual_limit=2)
            move_node["name"] = f"Move:{idx}"

        board[idx] = "" # Backtrack

        heatmap.append({"index": idx, "score": score})
        root_node["children"].append(move_node)

        if score > best_score:
            best_score = score
            best_idx = idx

    # Randomness for "Easy" mode
    if difficulty == "easy" and random.random() > 0.1:
        best_idx = random.choice(empty)

    final_winner = check_winner(board) # check after move
    calc_time = (time.time() - start_time) * 1000

    return MoveResponse(
        index=best_idx,
        winner=check_winner(board[:best_idx] + ["O"] + board[best_idx+1:]), # Predict winner
        is_draw=all(c != "" for c in board),
        heatmap=heatmap,
        tree=root_node,
        stats={"nodes_explored": stats.nodes_explored, "time_ms": round(calc_time, 2), "difficulty": difficulty}
    )