import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import Board from './components/Board';

// cell values
export type CellValue = 'Empty' | 'Red' | 'Yellow';

const SERVER_URL = 'http://localhost:3001/game';

const App: React.FC = () => {
  // Derive the socket type from io()
  type ClientSocket = ReturnType<typeof io>;
  const [socket, setSocket] = useState<ClientSocket | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [board, setBoard] = useState<CellValue[][]>(
    Array.from({ length: 6 }, () => Array(7).fill('Empty'))
  );
  const [currentPlayer, setCurrentPlayer] = useState<CellValue>('Red');
  const [status, setStatus] = useState<string>('Connecting…');

  useEffect(() => {
    const sock = io(SERVER_URL, { transports: ['websocket'] });
    setSocket(sock);

    sock.on('connect', () => {
      console.log('🔗 connected, id=', sock.id);
      setStatus('Creating game…');
      sock.emit('createGame', { playerId: 'Red' }, (res: { gameId: string }) => {
        console.log('➡️ createGame →', res.gameId);
        setGameId(res.gameId);
        setStatus('Your turn (Red)');
      });
    });

    sock.on('disconnect', () => {
      console.log('❌ disconnected');
      setStatus('Disconnected');
    });

    // Show AI "thinking" indicator if emitted
    sock.on('aiThinking', () => {
      setStatus('AI is thinking (Yellow)…');
    });

    // Single listener: handles both human & AI moves
    sock.on(
      'gameUpdate',
      (data: {
        board: CellValue[][];
        lastMove: { column: number; playerId: string };
        nextPlayer: CellValue;
        winner?: CellValue;
        draw?: boolean;
      }) => {
        console.log('⬅️ gameUpdate', data);
        const { board: newBoard, nextPlayer, winner, draw } = data;
        setBoard(newBoard);

        if (winner) {
          setStatus(`${winner} wins!`);
        } else if (draw) {
          setStatus('Draw game');
        } else if (nextPlayer === 'Red') {
          setStatus('Your turn (Red)');
        } else {
          setStatus('AI is thinking (Yellow)…');
        }

        setCurrentPlayer(nextPlayer);
      }
    );

    return () => {
      sock.disconnect();
    };
  }, []);

// Updated click handler: prevents moves after game over
function onColumnClick(col: number) {
  if (!socket || !gameId) return;

  // block if the game has finished
  if (status.endsWith('wins!') || status === 'Draw game') return;

  // only allow when it’s Red’s turn
  if (currentPlayer !== 'Red') return;

  console.log('➡️ human dropDisc at', col);
  // lock out further clicks until we get the next update
  setCurrentPlayer('Yellow');
  setStatus('Waiting for AI…');

  // Tell the server to apply both your move and the AI’s
  socket.emit('dropDisc', { gameId, playerId: 'Red', column: col });
}


  return (
    <div className="min-h-screen bg-blue-800 flex flex-col items-center justify-center p-4">
      <h1 className="text-white text-2xl mb-4">Connect Four vs. AI</h1>
      <Board board={board} onDrop={onColumnClick} />
      <div className="mt-4 text-white">{status}</div>
    </div>
  );
};

export default App;
