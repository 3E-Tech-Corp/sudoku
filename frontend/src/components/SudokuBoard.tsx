import { useState, useCallback, useEffect } from 'react';

interface SudokuBoardProps {
  initialBoard: number[][];
  currentBoard: number[][];
  solution: number[][];
  playerColors: Record<string, string>;
  myColor: string;
  onPlaceNumber: (row: number, col: number, value: number) => void;
  onEraseNumber: (row: number, col: number) => void;
  onToggleNote: (row: number, col: number, value: number) => void;
  notes: Record<string, number[]>;
  isCompleted: boolean;
}

export default function SudokuBoard({
  initialBoard,
  currentBoard,
  myColor,
  onPlaceNumber,
  onEraseNumber,
  onToggleNote,
  notes,
  isCompleted,
}: SudokuBoardProps) {
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [highlightNum, setHighlightNum] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);

  const isGiven = useCallback(
    (row: number, col: number) => initialBoard[row]?.[col] !== 0,
    [initialBoard]
  );

  const hasError = useCallback(
    (row: number, col: number) => {
      const val = currentBoard[row]?.[col];
      if (!val || val === 0) return false;

      for (let c = 0; c < 9; c++) {
        if (c !== col && currentBoard[row][c] === val) return true;
      }
      for (let r = 0; r < 9; r++) {
        if (r !== row && currentBoard[r][col] === val) return true;
      }
      const boxRow = Math.floor(row / 3) * 3;
      const boxCol = Math.floor(col / 3) * 3;
      for (let r = boxRow; r < boxRow + 3; r++) {
        for (let c = boxCol; c < boxCol + 3; c++) {
          if ((r !== row || c !== col) && currentBoard[r][c] === val) return true;
        }
      }
      return false;
    },
    [currentBoard]
  );

  const isInSameGroup = useCallback(
    (row: number, col: number) => {
      if (!selectedCell) return false;
      const { row: sr, col: sc } = selectedCell;
      if (row === sr) return true;
      if (col === sc) return true;
      const boxRow1 = Math.floor(sr / 3);
      const boxCol1 = Math.floor(sc / 3);
      const boxRow2 = Math.floor(row / 3);
      const boxCol2 = Math.floor(col / 3);
      return boxRow1 === boxRow2 && boxCol1 === boxCol2;
    },
    [selectedCell]
  );

  const handleCellClick = (row: number, col: number) => {
    if (isCompleted) return;
    if (isGiven(row, col)) {
      setHighlightNum(currentBoard[row][col]);
      setSelectedCell(null);
      return;
    }
    setSelectedCell({ row, col });
    const val = currentBoard[row]?.[col];
    setHighlightNum(val && val !== 0 ? val : null);
  };

  const handleNumberInput = useCallback(
    (num: number) => {
      if (!selectedCell || isCompleted) return;
      const { row, col } = selectedCell;
      if (isGiven(row, col)) return;

      if (notesMode) {
        onToggleNote(row, col, num);
      } else {
        onPlaceNumber(row, col, num);
        setHighlightNum(num);
      }
    },
    [selectedCell, isCompleted, isGiven, notesMode, onToggleNote, onPlaceNumber]
  );

  const handleErase = useCallback(() => {
    if (!selectedCell || isCompleted) return;
    const { row, col } = selectedCell;
    if (isGiven(row, col)) return;

    const val = currentBoard[row]?.[col];
    if (val && val !== 0) {
      onEraseNumber(row, col);
      setHighlightNum(null);
    }
  }, [selectedCell, isCompleted, isGiven, currentBoard, onEraseNumber]);

  // Keyboard support
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (isCompleted) return;

      // Toggle notes mode with 'n' key
      if (e.key === 'n' || e.key === 'N') {
        setNotesMode((prev) => !prev);
        return;
      }

      if (!selectedCell) return;

      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        handleNumberInput(num);
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleErase();
      } else if (e.key === 'ArrowUp' && selectedCell.row > 0) {
        setSelectedCell({ row: selectedCell.row - 1, col: selectedCell.col });
      } else if (e.key === 'ArrowDown' && selectedCell.row < 8) {
        setSelectedCell({ row: selectedCell.row + 1, col: selectedCell.col });
      } else if (e.key === 'ArrowLeft' && selectedCell.col > 0) {
        setSelectedCell({ row: selectedCell.row, col: selectedCell.col - 1 });
      } else if (e.key === 'ArrowRight' && selectedCell.col < 8) {
        setSelectedCell({ row: selectedCell.row, col: selectedCell.col + 1 });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedCell, isCompleted, handleNumberInput, handleErase]);

  // Count remaining for each number
  const numberCounts = Array(10).fill(0);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = currentBoard[r]?.[c];
      if (v && v > 0) numberCounts[v]++;
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Board */}
      <div className="inline-grid grid-cols-9 border-2 border-gray-300 bg-gray-800 select-none">
        {Array.from({ length: 9 }, (_, row) =>
          Array.from({ length: 9 }, (_, col) => {
            const value = currentBoard[row]?.[col] ?? 0;
            const given = isGiven(row, col);
            const selected = selectedCell?.row === row && selectedCell?.col === col;
            const sameGroup = isInSameGroup(row, col);
            const error = !given && hasError(row, col);
            const sameNum = highlightNum && value === highlightNum && value !== 0;
            const cellNotesArr = notes[`${row},${col}`] || [];
            const cellNotesSet = new Set(cellNotesArr);

            const borderRight = col % 3 === 2 && col !== 8 ? 'border-r-2 border-r-gray-400' : 'border-r border-r-gray-700';
            const borderBottom = row % 3 === 2 && row !== 8 ? 'border-b-2 border-b-gray-400' : 'border-b border-b-gray-700';

            let bgClass = 'bg-gray-800';
            if (selected) bgClass = 'bg-blue-900/70';
            else if (sameNum) bgClass = 'bg-blue-900/30';
            else if (sameGroup) bgClass = 'bg-gray-750 bg-gray-700/50';

            let textClass = 'text-gray-200';
            if (given) {
              textClass = 'text-white font-bold';
            } else if (error) {
              textClass = 'text-red-400 font-medium';
            } else if (value !== 0) {
              textClass = 'font-medium';
            }

            return (
              <button
                key={`${row}-${col}`}
                onClick={() => handleCellClick(row, col)}
                className={`
                  w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center relative
                  text-lg sm:text-xl transition-colors duration-100
                  ${borderRight} ${borderBottom} ${bgClass} ${textClass}
                  hover:bg-blue-800/40 focus:outline-none
                `}
                style={
                  !given && value !== 0 && !error
                    ? { color: myColor }
                    : undefined
                }
              >
                {value !== 0 ? (
                  value
                ) : cellNotesArr.length > 0 ? (
                  <div className="grid grid-cols-3 grid-rows-3 w-full h-full p-px">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <span
                        key={n}
                        className={`flex items-center justify-center text-[8px] sm:text-[9px] leading-none ${
                          cellNotesSet.has(n)
                            ? highlightNum === n
                              ? 'text-blue-300 font-bold'
                              : 'text-gray-400'
                            : 'text-transparent'
                        }`}
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                ) : (
                  ''
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Notes mode toggle + Number Pad */}
      <div className="flex flex-col items-center gap-3">
        {/* Notes toggle */}
        <button
          onClick={() => setNotesMode(!notesMode)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
            notesMode
              ? 'bg-amber-600 text-white ring-2 ring-amber-400'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          ✏️ Notes {notesMode ? 'ON' : 'OFF'}
          <span className="text-xs opacity-60">(N)</span>
        </button>

        {/* Number Pad */}
        <div className="flex flex-wrap justify-center gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
            const remaining = 9 - numberCounts[num];
            return (
              <button
                key={num}
                onClick={() => handleNumberInput(num)}
                disabled={isCompleted || (!notesMode && remaining <= 0)}
                className={`
                  w-12 h-14 sm:w-14 sm:h-16 rounded-lg text-xl font-bold
                  transition-all flex flex-col items-center justify-center
                  ${!notesMode && remaining <= 0
                    ? 'bg-gray-700 text-gray-600 cursor-not-allowed'
                    : notesMode
                    ? 'bg-gray-700 text-amber-400 hover:bg-amber-900/50 active:bg-amber-900 border border-amber-700/50'
                    : 'bg-gray-700 text-white hover:bg-blue-600 active:bg-blue-700'}
                `}
              >
                <span>{num}</span>
                {!notesMode && <span className="text-[10px] text-gray-400 font-normal">{remaining}</span>}
              </button>
            );
          })}
          <button
            onClick={handleErase}
            disabled={isCompleted}
            className="w-12 h-14 sm:w-14 sm:h-16 rounded-lg text-sm font-medium bg-gray-700 text-red-400 hover:bg-red-900/50 active:bg-red-900 transition-all"
          >
            Erase
          </button>
        </div>
      </div>
    </div>
  );
}
