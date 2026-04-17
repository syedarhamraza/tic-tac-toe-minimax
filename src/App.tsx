/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Circle, RefreshCcw, Cpu, User, Trophy, Hash, Zap, BrainCircuit, Activity, Volume2, VolumeX, BarChart3, Binary, Clock, Share2, Layers, Search, Eye, EyeOff, LayoutPanelLeft, GitGraph, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import confetti from "canvas-confetti";
import useSound from "use-sound";
import Tree from 'react-d3-tree';

type Player = "X" | "O" | null;

interface WinningCombo {
  player: Player;
  indices: number[];
}

interface Scores {
  human: number;
  ai: number;
  ties: number;
}

interface AIStats {
  nodes_explored: number;
  time_ms: number;
  difficulty: string;
}

interface HeatmapEntry {
  index: number;
  score: number;
}

interface HistoryEntry {
  winner: Player | "tie";
  board: Player[];
  timestamp: string;
}

export default function App() {
  const [board, setBoard] = useState<Player[]>(Array(9).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [winner, setWinner] = useState<Player | "tie">(null);
  const [winningCombo, setWinningCombo] = useState<WinningCombo | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [scores, setScores] = useState<Scores>({ human: 0, ai: 0, ties: 0 });
  const [isMuted, setIsMuted] = useState(false);
  const [difficulty, setDifficulty] = useState<"easy" | "minimax" | "alphabeta">("minimax");
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [lastHeatmap, setLastHeatmap] = useState<HeatmapEntry[]>([]);
  const [aiStats, setAiStats] = useState<AIStats | null>(null);
  const [aiTree, setAiTree] = useState<any>(null);
  const [showTreeView, setShowTreeView] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const boardRef = useRef<HTMLDivElement>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTreeView && treeContainerRef.current) {
      const { width, height } = treeContainerRef.current.getBoundingClientRect();
      setTranslate({ x: width / 2, y: 50 });
    }
  }, [showTreeView]);

  // Sound Hooks
  const [playMove] = useSound("https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3", { volume: 0.5, soundEnabled: !isMuted });
  const [playPlayerWin] = useSound("https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3", { volume: 0.5, soundEnabled: !isMuted });
  const [playAiWin] = useSound("https://assets.mixkit.co/active_storage/sfx/2570/2570-preview.mp3", { volume: 0.5, soundEnabled: !isMuted });
  const [playTie] = useSound("https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3", { volume: 0.5, soundEnabled: !isMuted });
  const [playReset] = useSound("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3", { volume: 0.5, soundEnabled: !isMuted });

  const triggerConfetti = useCallback(() => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };
    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) return clearInterval(interval);
      const particleCount = 50 * (timeLeft / duration);
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);
  }, []);

  const triggerHaptic = (type: "light" | "medium" = "light") => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(type === "light" ? 10 : 30);
    }
  };

  const calculateWinner = useCallback((squares: Player[]): { result: Player | "tie", combo: number[] | null } => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];
    for (const [a, b, c] of lines) {
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return { result: squares[a], combo: [a, b, c] };
      }
    }
    return { result: squares.includes(null) ? null : "tie", combo: null };
  }, []);

  const handleGameOver = useCallback((result: Player | "tie", combo: number[] | null, finalBoard: Player[]) => {
    setWinner(result);
    if (combo) setWinningCombo({ player: (result === "tie" ? null : result) as Player, indices: combo });
    
    // Add to history
    setHistory(prev => [{
      winner: result,
      board: finalBoard,
      timestamp: new Date().toLocaleTimeString()
    }, ...prev].slice(0, 10));

    if (result === "X") {
      playPlayerWin();
      triggerConfetti();
      triggerHaptic("medium");
      setScores(prev => ({ ...prev, human: prev.human + 1 }));
    } else if (result === "O") {
      playAiWin();
      triggerHaptic("medium");
      setScores(prev => ({ ...prev, ai: prev.ai + 1 }));
    } else if (result === "tie") {
      playTie();
      triggerHaptic("light");
      setScores(prev => ({ ...prev, ties: prev.ties + 1 }));
    }
  }, [playPlayerWin, playAiWin, playTie, triggerConfetti]);

  const getAiMove = useCallback(async (currentBoard: Player[]) => {
    setIsAiThinking(true);
    try {
      const response = await fetch("/api/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: currentBoard, difficulty }),
      });
      const data = await response.json();
      
      setLastHeatmap(data.heatmap || []);
      setAiStats(data.stats || null);
      setAiTree(data.tree || null);

      const newBoard = [...currentBoard];
      newBoard[data.index] = "O";
      setBoard(newBoard);
      setIsXNext(true);
      playMove();
      triggerHaptic("light");

      const { result, combo } = calculateWinner(newBoard);
      if (result) {
        handleGameOver(result, combo, newBoard);
      }
    } catch (error) {
      console.error("AI Move failed:", error);
    } finally {
      setIsAiThinking(false);
    }
  }, [calculateWinner, handleGameOver, playMove, difficulty]);

  useEffect(() => {
    if (!isXNext && !winner && !isAiThinking) {
      const timer = setTimeout(() => getAiMove(board), 600);
      return () => clearTimeout(timer);
    }
  }, [isXNext, winner, board, isAiThinking, getAiMove]);

  const handleClick = async (i: number) => {
    if (board[i] || winner || isAiThinking || !isXNext) return;

    playMove();
    triggerHaptic();
    const newBoard = [...board];
    newBoard[i] = "X";
    setBoard(newBoard);
    setIsXNext(false);
    setLastHeatmap([]); // Clear heatmap on player move

    const { result, combo } = calculateWinner(newBoard);
    if (result) {
      handleGameOver(result, combo, newBoard);
    }
  };

  const resetGame = () => {
    playReset();
    triggerHaptic("light");
    setBoard(Array(9).fill(null));
    setIsXNext(true);
    setWinner(null);
    setWinningCombo(null);
    setIsAiThinking(false);
    setAiStats(null);
    setAiTree(null);
    setLastHeatmap([]);
  };

  const getLineCoords = () => {
    if (!winningCombo) return null;
    const [a, c] = [winningCombo.indices[0], winningCombo.indices[2]];
    const cellSize = 100 / 3;
    const getPos = (idx: number) => ({
      x: (idx % 3) * cellSize + cellSize / 2,
      y: Math.floor(idx / 3) * cellSize + cellSize / 2
    });
    const start = getPos(a);
    const end = getPos(c);
    return { x1: `${start.x}%`, y1: `${start.y}%`, x2: `${end.x}%`, y2: `${end.y}%` };
  };

  const lineCoords = getLineCoords();

  const getCellHeatmapColor = (index: number) => {
    if (!showHeatmap || isAiThinking) return null;
    const entry = lastHeatmap.find(h => h.index === index);
    if (!entry) return null;
    
    // Scale: -10 (loss for AI) to 10 (win for AI)
    // Blue for good moves (for AI), Red for bad moves
    if (entry.score > 0) return `rgba(251, 113, 133, ${Math.abs(entry.score) / 10 * 0.2})`; // Rose/Red for AI win
    if (entry.score < 0) return `rgba(56, 189, 248, ${Math.abs(entry.score) / 10 * 0.2})`; // Sky/Blue for AI loss
    return "rgba(255, 255, 255, 0.03)"; // Neutral/Draw
  };

  const renderCustomNode = ({ nodeDatum, toggleNode }: any) => (
    <g>
      <circle 
        r="20" 
        fill={nodeDatum.attributes?.pruned ? "#334155" : (nodeDatum.name.includes('AI') ? "#fb7185" : "#38bdf8")} 
        className={nodeDatum.attributes?.pruned ? "opacity-30" : "opacity-80"}
      />
      <text 
        fill="white" 
        strokeWidth="0.5" 
        x="25" 
        dy=".33em" 
        className="text-[10px] font-mono uppercase tracking-tighter"
      >
        {nodeDatum.name}
      </text>
      {nodeDatum.attributes?.score !== undefined && (
        <text 
          fill={nodeDatum.attributes.score > 0 ? "#fb7185" : "#38bdf8"} 
          x="25" 
          dy="1.5em" 
          className="text-[8px] font-black"
        >
          {nodeDatum.attributes.score}
        </text>
      )}
      {nodeDatum.attributes?.pruned && (
        <text fill="#fb7185" x="-5" dy=".33em" className="text-[12px]">✂️</text>
      )}
    </g>
  );

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 sm:p-8 relative overflow-hidden font-sans text-slate-200">
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-500 rounded-full blur-[160px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-rose-500 rounded-full blur-[160px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="flex flex-col lg:flex-row gap-8 max-w-6xl w-full z-10">
        
        {/* Left Stats Section (Human Focus) */}
        <div className="hidden xl:flex flex-col gap-4 w-64 order-first">
           <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-white/[0.02]">
               <div className="flex items-center gap-3 mb-6">
                   {/* Profile Picture Container */}
                   <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-sky-400/30 shadow-[0_0_15px_rgba(56,189,248,0.2)]">
                       <img
                           src="/profile.png" // Put your photo in the public folder and name it profile.jpg
                           alt="Arham"
                           className="w-full h-full object-cover"
                           onError={(e) => {
                               // Fallback to icon if image fails to load
                               e.currentTarget.src = "https://ui-avatars.com/api/?name=Arham&background=0ea5e9&color=fff";
                           }}
                       />
                   </div>
                   <h3 className="font-mono text-xs uppercase tracking-widest text-white/60">Human_Arham</h3>
               </div>
              <div className="space-y-6">
                 <div>
                    <label className="font-mono text-[9px] uppercase text-white/20 tracking-tighter block mb-1">Victory_Ratio</label>
                    <div className="text-3xl font-black text-sky-400 tracking-tighter">
                      {scores.human + scores.ai + scores.ties > 0 
                        ? ((scores.human / (scores.human + scores.ai + scores.ties)) * 100).toFixed(1)
                        : "0.0"}%
                    </div>
                 </div>
                 <div className="h-px bg-white/5" />
                 <div>
                    <label className="font-mono text-[9px] uppercase text-white/20 tracking-tighter block mb-1">Current_Elo</label>
                    <div className="text-xl font-bold text-white/60 tracking-tight">1420_RANK</div>
                 </div>
              </div>
           </div>

           <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-white/[0.02] flex-grow flex flex-col overflow-hidden">
              <div className="flex items-center gap-3 mb-6">
                 <LayoutPanelLeft className="w-4 h-4 text-white/30" />
                 <h3 className="font-mono text-xs uppercase tracking-widest text-white/40">Game_History</h3>
              </div>
              <div className="space-y-3 flex-grow overflow-y-auto pr-2 custom-scrollbar">
                 {history.length > 0 ? history.map((entry, idx) => (
                   <div key={`history-entry-${entry.timestamp}-${idx}`} className="p-3 rounded-xl bg-black/20 border border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${entry.winner === 'X' ? 'border-sky-500/20 bg-sky-500/10' : entry.winner === 'O' ? 'border-rose-500/20 bg-rose-500/10' : 'border-white/10 bg-white/5'}`}>
                           {entry.winner === 'X' ? <User className="w-4 h-4 text-sky-400" /> : entry.winner === 'O' ? <Cpu className="w-4 h-4 text-rose-400" /> : <RefreshCcw className="w-3 h-3 text-white/40" />}
                        </div>
                        <div>
                           <p className="text-[10px] font-bold text-white/60 mb-0.5">{entry.winner === 'tie' ? 'Equilibrium' : entry.winner === 'X' ? 'Pilot_Victory' : 'Deepmind_Win'}</p>
                           <p className="text-[8px] font-mono text-white/20">{entry.timestamp}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-0.5 opacity-20">
                         {entry.board.map((c, i) => (
                           <div key={`thumb-cell-${i}`} className={`w-1.5 h-1.5 rounded-full ${c === 'X' ? 'bg-sky-400' : c === 'O' ? 'bg-rose-400' : 'bg-white/10'}`} />
                         ))}
                      </div>
                   </div>
                 )) : (
                   <div className="h-full flex flex-col items-center justify-center text-center p-4">
                      <Clock className="w-8 h-8 text-white/5 mb-3" />
                      <p className="font-mono text-[9px] uppercase tracking-widest text-white/20">No archives found.</p>
                   </div>
                 )}
              </div>
           </div>
        </div>

        {/* Main Game Section */}
        <div className="flex-grow max-w-md mx-auto w-full">
          <div className="flex flex-col gap-6">
            <header className="flex items-center justify-between">
              <div className="flex flex-col">
                <h1 className="font-mono text-[10px] tracking-[0.4em] uppercase text-white/30 flex items-center gap-2 mb-1">
                  <Binary className="w-3 h-3" /> Grid_Core
                </h1>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  <span className="font-mono text-[9px] uppercase font-black text-emerald-500 tracking-tighter">Real-Time_Link_Stable</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                 <button 
                   onClick={() => setShowTreeView(!showTreeView)}
                   className={`p-2.5 rounded-xl border transition-all flex items-center gap-2 ${showTreeView ? 'bg-sky-500/20 border-sky-400/30 text-sky-400' : 'border-white/5 bg-white/[0.02] text-white/40 hover:text-white/60'}`}
                   title="Toggle Decision Tree"
                 >
                   <GitGraph className="w-4 h-4" />
                   <span className="font-mono text-[8px] uppercase tracking-widest hidden sm:inline">Tree_Map</span>
                 </button>
                 <button 
                   onClick={() => setIsMuted(!isMuted)}
                   className="p-2.5 rounded-xl border border-white/5 glass-panel bg-white/[0.02] hover:bg-white/[0.05] transition-all"
                 >
                   {isMuted ? <VolumeX className="w-4 h-4 text-white/40" /> : <Volume2 className="w-4 h-4 text-white/60" />}
                 </button>
              </div>
            </header>

            {/* Score Display */}
            <div className="grid grid-cols-3 gap-3">
               {[
                 { label: 'Human', val: scores.human, color: 'text-sky-400' },
                 { label: 'Ties', val: scores.ties, color: 'text-white/40' },
                 { label: 'AI', val: scores.ai, color: 'text-rose-400' }
               ].map(s => (
                 <div key={s.label} className="glass-panel p-4 rounded-2xl border border-white/5 text-center bg-white/[0.01]">
                    <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/20 block mb-1">{s.label}</span>
                    <span className={`text-2xl font-black ${s.color} tracking-tighter`}>{s.val}</span>
                 </div>
               ))}
            </div>

            {/* AI Control Selector */}
            <div className="glass-panel p-1 rounded-2xl border border-white/5 bg-white/[0.02]">
               <div className="grid grid-cols-3 gap-1">
                 {(['easy', 'minimax', 'alphabeta'] as const).map((m) => (
                   <button
                    key={m}
                    onClick={() => setDifficulty(m)}
                    disabled={isAiThinking || board.some(c => c !== null) || !!winner}
                    className={`relative py-3 rounded-xl font-mono text-[9px] uppercase tracking-[0.2em] transition-all
                      ${difficulty === m 
                        ? 'text-white font-bold bg-white/[0.05] shadow-[inset_0_0_10px_rgba(255,255,255,0.05)] border border-white/10' 
                        : 'text-white/20 hover:text-white/40 border border-transparent'}
                      ${(isAiThinking || board.some(c => c !== null) || !!winner) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                   >
                     {difficulty === m && (
                       <motion.div layoutId="active-bg" className="absolute inset-0 bg-white/[0.03] rounded-xl border border-white/10" />
                     )}
                     <span className="relative">{m === 'alphabeta' ? 'A_Pruning' : m}</span>
                   </button>
                 ))}
               </div>
            </div>

            {/* Main Board */}
            <div className="relative group/board">
              <div className="absolute -inset-4 bg-gradient-to-tr from-sky-400/5 via-transparent to-rose-400/5 rounded-[40px] blur-2xl opacity-0 group-hover/board:opacity-100 transition-opacity duration-1000" />
              
              <div className="relative p-1 rounded-3xl bg-slate-900/50 border border-white/10 overflow-hidden shadow-[0_40px_80px_-20px_rgba(0,0,0,0.7)]">
                <div className="grid grid-cols-3 gap-1 aspect-square relative z-10">
                  {board.map((cell, i) => (
                    <motion.button
                      key={`grid-cell-${i}`}
                      whileHover={!cell && !winner && isXNext ? { scale: 0.98 } : {}}
                      whileTap={!cell && !winner && isXNext ? { scale: 0.95 } : {}}
                      onClick={() => handleClick(i)}
                      disabled={!!cell || !!winner || isAiThinking || !isXNext}
                      style={{ 
                        backgroundColor: cell ? 'rgba(15, 23, 42, 0.5)' : (getCellHeatmapColor(i) || 'rgba(15, 23, 42, 0.5)') 
                      }}
                      className={`group relative flex items-center justify-center transition-all duration-700 cell-inset
                        ${!cell && !winner && isXNext ? 'cursor-crosshair' : 'cursor-default'}
                        ${winningCombo?.indices.includes(i) ? 'bg-white/[0.08]' : ''}`}
                    >
                      {/* Interactive Border Aura */}
                      {!cell && !winner && isXNext && (
                         <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 border border-sky-400/10" />
                      )}

                      {/* Heatmap score label */}
                      {!cell && !winner && showHeatmap && lastHeatmap.find(h => h.index === i) && (
                        <motion.span 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 0.2 }}
                          className="absolute top-2 left-2 font-mono text-[8px] tracking-tighter"
                        >
                          EVL:{lastHeatmap.find(h => h.index === i)?.score}
                        </motion.span>
                      )}

                      {/* Ghost Marker */}
                      {!cell && !winner && isXNext && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.8 }}
                          whileHover={{ opacity: 0.15, scale: 1 }}
                          className="pointer-events-none"
                        >
                          <X className="w-10 h-10 text-sky-400" strokeWidth={1} />
                        </motion.div>
                      )}

                      <AnimatePresence mode="popLayout">
                        {cell === "X" && (
                          <motion.div
                            key="X"
                            initial={{ scale: 0.2, opacity: 0, rotate: -45 }}
                            animate={{ scale: 1, opacity: 1, rotate: 0 }}
                            transition={{ type: "spring", stiffness: 350, damping: 25 }}
                            className="text-sky-400 drop-shadow-[0_0_15px_rgba(56,189,248,0.5)]"
                          >
                            <X className="w-12 h-12 sm:w-16 sm:h-16" strokeWidth={2.5} />
                          </motion.div>
                        )}
                        {cell === "O" && (
                          <motion.div
                            key="O"
                            initial={{ scale: 0.2, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", stiffness: 350, damping: 25 }}
                            className="text-rose-400 drop-shadow-[0_0_15px_rgba(251,113,133,0.5)]"
                          >
                            <Circle className="w-12 h-12 sm:w-16 sm:h-16" strokeWidth={2.5} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  ))}

                  {/* AI Thinking Overlay */}
                  {isAiThinking && !winner && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center backdrop-blur-[1px] bg-slate-900/60">
                      <motion.div className="flex flex-col items-center gap-4 bg-black/40 p-6 rounded-3xl border border-rose-500/10 shadow-[0_0_40px_rgba(251,113,133,0.1)]">
                        <div className="flex gap-1.5 items-end h-8">
                          {[0, 1, 2, 3].map(i => (
                            <motion.div
                              key={`thinking-bar-${i}`}
                              animate={{ height: [8, 28, 8] }}
                              transition={{ repeat: Infinity, duration: 1, delay: i * 0.1 }}
                              className="w-1.5 bg-rose-400 rounded-full shadow-[0_0_8px_rgba(251,113,133,0.5)]"
                            />
                          ))}
                        </div>
                        <span className="font-mono text-[9px] tracking-[0.3em] text-rose-400 font-black animate-pulse">
                          MINIMAX_SYNT_LOGIC
                        </span>
                      </motion.div>
                    </div>
                  )}

                  {/* Winner Line SVG */}
                  {winningCombo && lineCoords && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none z-30 overflow-visible">
                      <motion.line
                        x1={lineCoords.x1}
                        y1={lineCoords.y1}
                        x2={lineCoords.x1}
                        y2={lineCoords.y1}
                        animate={{ x2: lineCoords.x2, y2: lineCoords.y2 }}
                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        stroke={winningCombo.player === "X" ? "#38bdf8" : "#fb7185"}
                        strokeWidth="10"
                        strokeLinecap="round"
                        className="filter drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                      />
                    </svg>
                  )}
                </div>
              </div>
            </div>

            <footer className="mt-4 flex items-center justify-between">
               <button 
                 onClick={resetGame}
                 className="px-6 py-3 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all flex items-center gap-3 group active:scale-95"
               >
                 <RefreshCcw className="w-4 h-4 text-white/40 group-hover:rotate-180 transition-transform duration-700" />
                 <span className="font-mono text-[10px] uppercase font-bold tracking-[0.2em] text-white/60">Reset_Cycle</span>
               </button>

               <div className="flex flex-col items-end">
                  <span className="font-mono text-[8px] uppercase text-white/20 tracking-widest mb-1">Grid_Status</span>
                  <AnimatePresence mode="wait">
                    <motion.p 
                      key={winner || isAiThinking ? "W" : "P"}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="font-mono text-[11px] font-bold tracking-tight uppercase"
                    >
                      {winner ? "Terminal_Reached" : isAiThinking ? "Proc_Evaluating" : "Awaiting_Input"}
                    </motion.p>
                  </AnimatePresence>
               </div>
            </footer>
          </div>
        </div>

        {/* Right Dashboard Section (AI Focus) */}
        <div className="hidden lg:flex flex-col gap-4 w-72">
           <div className="glass-panel p-6 rounded-3xl border border-rose-500/5 bg-rose-500/[0.01]">
              <div className="flex items-center gap-3 mb-6">
                 <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center border border-rose-500/30">
                    <Cpu className="w-4 h-4 text-rose-500" />
                 </div>
                 <h3 className="font-mono text-xs uppercase tracking-widest text-white/60">AI_Deepmind</h3>
              </div>
              
              <AnimatePresence mode="wait">
                {aiStats ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-5"
                  >
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                           <Layers className="w-3 h-3 text-white/20" />
                           <span className="font-mono text-[10px] text-white/40">Nodes_Explored</span>
                        </div>
                        <span className="font-mono text-xs font-black text-rose-400">{aiStats.nodes_explored.toLocaleString()}</span>
                     </div>
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                           <Clock className="w-3 h-3 text-white/20" />
                           <span className="font-mono text-[10px] text-white/40">Time_Complexity</span>
                        </div>
                        <span className="font-mono text-xs font-black text-white/60">{aiStats.time_ms}ms</span>
                     </div>
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                           <Binary className="w-3 h-3 text-white/20" />
                           <span className="font-mono text-[10px] text-white/40">Efficiency</span>
                        </div>
                        <span className="font-mono text-xs font-black text-emerald-400">
                          {aiStats.nodes_explored > 1000 ? '99.2%' : '100%'}
                        </span>
                     </div>
                     <div className="pt-4 mt-4 border-t border-white/5">
                        <div className="flex items-center gap-2 mb-3">
                           <Search className="w-3 h-3 text-white/20" />
                           <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">Evaluation_Map</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                           {Array(9).fill(null).map((_, idx) => {
                             const heat = lastHeatmap.find(h => h.index === idx);
                             return (
                               <div key={`eval-cell-${idx}`} className={`h-8 rounded border transition-colors ${heat ? 'bg-rose-500/10 border-rose-500/20' : 'bg-white/[0.02] border-white/5'}`}>
                                  {heat && <div className="w-full h-full flex items-center justify-center font-mono text-[7px] text-rose-400/80">{heat.score}</div>}
                               </div>
                             );
                           })}
                        </div>
                     </div>
                  </motion.div>
                ) : (
                  <div className="h-48 flex flex-col items-center justify-center text-center p-4">
                     <BrainCircuit className="w-10 h-10 text-white/5 mb-4 animate-pulse" />
                     <p className="font-mono text-[9px] uppercase tracking-widest text-white/20 max-w-[120px]">
                        Awaiting move calculation for live trace...
                     </p>
                  </div>
                )}
              </AnimatePresence>
           </div>

           <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-3 mb-4">
                 <Zap className="w-4 h-4 text-amber-400" />
                 <h3 className="font-mono text-xs uppercase tracking-widest text-white/40">System_Metrics</h3>
              </div>
              <div className="space-y-4">
                 <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-[10px] font-mono uppercase text-white/30">
                       <span>Grid_Density</span>
                       <span>{Math.round((board.filter(c => c !== null).length / 9) * 100)}%</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                       <motion.div 
                         initial={{ width: 0 }}
                         animate={{ width: `${(board.filter(c => c !== null).length / 9) * 100}%` }}
                         className="h-full bg-sky-500/50" 
                       />
                    </div>
                 </div>
                 <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-[10px] font-mono uppercase text-white/30">
                       <span>Neural_Load</span>
                       <span>{isAiThinking ? '82%' : '12%'}</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                       <motion.div 
                         animate={{ width: isAiThinking ? '82%' : '12%' }}
                         className="h-full bg-rose-500/50" 
                       />
                    </div>
                 </div>
              </div>
           </div>
        </div>

      </div>

      {/* Global Overlays */}
      <AnimatePresence>
        {showTreeView && aiTree && (
          <motion.div
            key="tree-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-[#0f172a]/95 backdrop-blur-xl flex flex-col p-4 sm:p-10"
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex flex-col">
                <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Neural Decision Tree</h2>
                <p className="font-mono text-[9px] text-white/30 uppercase tracking-[0.4em]">Visualizing path exploration & Alpha-Beta pruning cuts</p>
              </div>
              <button 
                onClick={() => setShowTreeView(false)}
                className="p-3 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div 
              ref={treeContainerRef}
              className="flex-grow rounded-3xl border border-white/10 bg-black/40 overflow-hidden relative"
            >
               <Tree 
                 data={aiTree} 
                 orientation="vertical"
                 translate={translate}
                 pathClassFunc={() => 'stroke-white/10 stroke-[2px]'}
                 renderCustomNodeElement={renderCustomNode}
                 dimensions={treeContainerRef.current?.getBoundingClientRect()}
                 separation={{ siblings: 2, nonSiblings: 2.5 }}
                 enableLegacyTransitions={true}
                 transitionDuration={800}
               />
               
               <div className="absolute bottom-6 right-6 p-4 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-md max-w-xs">
                  <h4 className="font-mono text-[10px] uppercase text-white/60 mb-2 border-b border-white/5 pb-2">Legend</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-rose-400" />
                       <span className="text-[10px] text-white/40">AI Decision Nodes</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-sky-400" />
                       <span className="text-[10px] text-white/40">User Response Prediction</span>
                    </div>
                    <div className="flex items-center gap-2 opacity-40">
                       <div className="w-2 h-2 rounded-full bg-slate-500" />
                       <span className="text-[10px] text-white/40">Pruned Branches (Cuts)</span>
                    </div>
                  </div>
               </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-4 justify-between items-center bg-white/[0.02] p-6 rounded-3xl border border-white/5">
                <div className="flex gap-10">
                   <div>
                      <span className="block font-mono text-[9px] uppercase text-white/20 mb-1">Cuts_Detected</span>
                      <span className="font-mono text-xs font-bold text-rose-400">{(aiTree?.children?.length || 0) < 9 ? 'System_Optimized' : 'Raw_Compute'}</span>
                   </div>
                   <div>
                      <span className="block font-mono text-[9px] uppercase text-white/20 mb-1">Visualization_Depth</span>
                      <span className="font-mono text-xs font-bold text-emerald-400">LEVEL_3_MAP</span>
                   </div>
                </div>
                <button 
                  onClick={() => setShowTreeView(false)}
                  className="px-8 py-3 rounded-xl bg-white/10 hover:bg-white/20 font-mono text-[10px] uppercase tracking-widest font-bold transition-all"
                >
                  Close_Debugger
                </button>
            </div>
          </motion.div>
        )}

        {winner && (
          <motion.div
            key="winner-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#0f172a]/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              className={`max-w-sm w-full p-10 rounded-[40px] border glass-panel text-center
                ${winner === "tie" ? "border-amber-400/20 shadow-amber-400/5" : winner === "X" ? "border-sky-400/20 shadow-sky-400/5" : "border-rose-400/20 shadow-rose-400/5"}`}
            >
              <Trophy className={`w-20 h-20 mx-auto mb-8 ${winner === "tie" ? "text-amber-400" : winner === "X" ? "text-sky-400" : "text-rose-400"}`} strokeWidth={1} />
              <h2 className="font-bold text-4xl uppercase tracking-tighter mb-4 italic">
                {winner === "tie" ? "Draw Detected" : winner === "X" ? "Cycle Victory" : "AI Optimized"}
              </h2>
              <p className="font-mono text-[10px] text-white/30 uppercase tracking-[0.6em] mb-10 leading-relaxed">
                Sequence complete. Node connectivity successfully verified.
              </p>
              
              <div className="flex flex-col gap-3">
                <button
                  onClick={resetGame}
                  className={`w-full py-5 rounded-2xl font-mono text-xs font-black uppercase tracking-[0.4em] transition-all
                    ${winner === "X" ? "bg-sky-400 text-slate-900 shadow-[0_20px_40px_rgba(56,189,248,0.2)]" : 
                      winner === "O" ? "bg-rose-400 text-slate-900 shadow-[0_20px_40px_rgba(251,113,133,0.2)]" : 
                      "bg-amber-400 text-slate-900 shadow-[0_20px_40px_rgba(251,191,36,0.2)]"}`}
                >
                  Re_Initialize
                </button>
                
                {aiTree && (
                  <button
                    onClick={() => setShowTreeView(true)}
                    className="w-full py-4 rounded-2xl font-mono text-[9px] font-bold uppercase tracking-[0.2em] bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-white/60"
                  >
                    View_Final_Graph
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

        <footer className="absolute bottom-6 left-0 right-0 flex justify-center items-center z-20 pointer-events-auto">
            <motion.a
                href="https://syedarhamraza-portfolio.vercel.app/"
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.4 }}
                whileHover={{ opacity: 1, scale: 1.05 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 bg-white/[0.02] backdrop-blur-md transition-all group"
            >
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/60 group-hover:text-sky-400 transition-colors">
            Developed_by
          </span>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-white group-hover:text-sky-400 transition-colors">
            Arham
          </span>
                <div className="w-1 h-1 rounded-full bg-rose-500 animate-pulse group-hover:bg-sky-400" />
            </motion.a>
        </footer>
    </div>
  );
}
