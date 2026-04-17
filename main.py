from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import random
import math

import time

app = FastAPI(title="Tic-Tac-Toe AI Backend")

# Configuration to track stats
class AIStats:
    def __init__(self):
        self.nodes_explored = 0

stats = AIStats()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

WINNING_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
]

def check_winner(board: List[str]) -> Optional[str]:
    for combo in WINNING_COMBOS:
        a, b, c = combo
        if board[a] and board[a] == board[b] == board[c]:
            return board[a]
    return None

def is_draw(board: List[str]) -> bool:
    return all(cell != "" for cell in board) and check_winner(board) is None

def get_empty_cells(board: List[str]) -> List[int]:
    return [i for i, cell in enumerate(board) if cell == ""]

# ── TREE HELPER ──────────────────────────────────────────────────
def build_tree_node(board: List[str], depth: int, is_maximizing: bool, alpha: float, beta: float, difficulty: str, max_depth: int = 9, visual_limit: int = 2):
    current_winner = check_winner(board)
    if current_winner == "O": return 10, {"name": "O", "attributes": {"score": 10}, "children": []}
    if current_winner == "X": return -10, {"name": "X", "attributes": {"score": -10}, "children": []}
    if is_draw(board): return 0, {"name": "Draw", "attributes": {"score": 0}, "children": []}
    
    if depth >= max_depth:
        return 0, {"name": f"Terminal", "attributes": {"score": 0}, "children": []}

    stats.nodes_explored += 1
    empty = get_empty_cells(board)
    children = []
    
    if is_maximizing:
        best = -math.inf
        for idx in empty:
            board[idx] = "O"
            score, child_node = build_tree_node(board, depth + 1, False, alpha, beta, difficulty, max_depth, visual_limit)
            board[idx] = ""
            best = max(best, score)
            alpha = max(alpha, best)
            
            if depth < visual_limit:
                child_node["name"] = f"AI:{idx}"
                children.append(child_node)
            
            if difficulty == "alphabeta" and beta <= alpha:
                if children: children[-1]["attributes"]["pruned"] = True
                break
        
        node = {"name": "AI_Turn", "attributes": {"score": best}}
        if depth < visual_limit: node["children"] = children
        return best, node
    else:
        best = math.inf
        for idx in empty:
            board[idx] = "X"
            score, child_node = build_tree_node(board, depth + 1, True, alpha, beta, difficulty, max_depth, visual_limit)
            board[idx] = ""
            best = min(best, score)
            beta = min(beta, best)
            
            if depth < visual_limit:
                child_node["name"] = f"User:{idx}"
                children.append(child_node)
            
            if difficulty == "alphabeta" and beta <= alpha:
                if children: children[-1]["attributes"]["pruned"] = True
                break
                
        node = {"name": "User_Turn", "attributes": {"score": best}}
        if depth < visual_limit: node["children"] = children
        return best, node

@app.post("/api/move", response_model=MoveResponse)
def get_move(req: MoveRequest):
    start_time = time.time()
    stats.nodes_explored = 0
    
    board = ["" if cell is None else cell for cell in req.board]
    difficulty = req.difficulty.lower()
    empty = get_empty_cells(board)
    
    if not empty:
        winner = check_winner(board)
        return MoveResponse(index=-1, winner=winner, is_draw=is_draw(board))

    heatmap = []
    best_idx = -1
    best_score = -math.inf
    
    # Root for the tree visualization
    root_node = {"name": "AI_ROOT", "children": []}

    for idx in empty:
        board[idx] = "O"
        if difficulty == "easy":
            score = 1 if check_winner(board) == "O" else 0
            stats.nodes_explored += 1
            node = {"name": f"Move:{idx}", "attributes": {"score": score}, "children": []}
        elif difficulty == "alphabeta":
            # Search depth 9 for moves, but limit visual tree to depth 2
            score, node = build_tree_node(board, 1, False, -math.inf, math.inf, difficulty, max_depth=9, visual_limit=2)
            node["name"] = f"Move:{idx}"
        else: # minimax
            score, node = build_tree_node(board, 1, False, -math.inf, math.inf, "minimax", max_depth=9, visual_limit=2)
            node["name"] = f"Move:{idx}"
        
        board[idx] = ""
        heatmap.append({"index": idx, "score": score})
        root_node["children"].append(node)
        
        if score > best_score:
            best_score = score
            best_idx = idx

    if difficulty == "easy" and random.random() > 0.05:
        best_idx = random.choice(empty)

    idx_final = best_idx
    board[idx_final] = "O"
    winner = check_winner(board)
    draw = is_draw(board)
    calc_time = (time.time() - start_time) * 1000

    return MoveResponse(
        index=idx_final, 
        winner=winner, 
        is_draw=draw,
        heatmap=heatmap,
        tree=root_node,
        stats={
            "nodes_explored": stats.nodes_explored,
            "time_ms": round(calc_time, 2),
            "difficulty": difficulty
        }
    )

@app.get("/api/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
